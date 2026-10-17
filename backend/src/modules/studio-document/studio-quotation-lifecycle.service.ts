import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocType, DocTypeDocument } from '../doc-type/doc-type.schema';
import { QuotationService } from '../quotation/quotation.service';
import type { QuotationDocument } from '../quotation/quotation.schema';
import type { QuotationItem } from '../quotation/quotation.schema';
import { TemplateBlockService } from '../template-block/template-block.service';
import { StudioDataResolverService } from './studio-data-resolver';
import type { StudioDocumentDocument } from './studio-document.schema';

const KP_DOC_TYPE_SLUG = 'proposal';

function quotationOrgRefId(value: unknown): string {
  // QuotationService.findById populates organizationId, so the field can be
  // either a raw ObjectId or a populated Organization document.
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return value == null ? '' : String(value);
}

@Injectable()
export class StudioQuotationLifecycleService {
  constructor(
    @InjectModel(DocType.name)
    private readonly docTypeModel: Model<DocTypeDocument>,
    private readonly quotationService: QuotationService,
    private readonly blockService: TemplateBlockService,
    private readonly dataResolver: StudioDataResolverService,
  ) {}

  async isKpDocument(doc: StudioDocumentDocument): Promise<boolean> {
    if (!doc.docTypeId) return false;
    const docType = await this.docTypeModel.findById(doc.docTypeId).lean().exec();
    return docType?.slug === KP_DOC_TYPE_SLUG;
  }

  async ensureLinkedQuotation(
    doc: StudioDocumentDocument,
    organizationId: string,
  ): Promise<{ doc: StudioDocumentDocument; quotation: QuotationDocument | null }> {
    if (!(await this.isKpDocument(doc))) {
      return { doc, quotation: null };
    }

    if (doc.linkedQuotationId) {
      const quotation = await this.quotationService.findById(doc.linkedQuotationId.toString());
      this.assertQuotationOrg(quotation, organizationId);
      return { doc, quotation };
    }

    const context = doc.context ?? {};
    const counterpartyId =
      typeof context['counterpartyId'] === 'string' ? context['counterpartyId'] : undefined;

    const quotation = await this.quotationService.create({
      organizationId,
      counterpartyId,
      status: 'draft',
      items: [],
      studioDocumentId: doc._id.toString(),
    });

    doc.linkedQuotationId = quotation._id;
    doc.context = { ...context, quotationId: quotation._id.toString() };
    await doc.save();

    return { doc, quotation };
  }

  async syncQuotationItems(
    doc: StudioDocumentDocument,
    organizationId: string,
  ): Promise<QuotationDocument | null> {
    if (!doc.linkedQuotationId) return null;

    const quotationId = doc.linkedQuotationId.toString();
    let quotation: QuotationDocument;
    try {
      quotation = await this.quotationService.findById(quotationId);
      this.assertQuotationOrg(quotation, organizationId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      // Dead/foreign linkedQuotationId (deleted or cross-org Quotation): heal
      // the stale FK instead of surfacing a hard 404 to the operator.
      return this.healOrphanQuotationLink(doc, organizationId, quotationId);
    }

    return this.performSync(doc, quotation);
  }

  private async healOrphanQuotationLink(
    doc: StudioDocumentDocument,
    organizationId: string,
    deadQuotationId: string,
  ): Promise<QuotationDocument | null> {
    doc.linkedQuotationId = undefined;
    if (doc.context?.['quotationId'] === deadQuotationId) {
      const rest = { ...doc.context };
      delete rest['quotationId'];
      doc.context = rest;
    }
    await doc.save();

    const { quotation } = await this.ensureLinkedQuotation(doc, organizationId);
    if (!quotation) return null;

    return this.performSync(doc, quotation);
  }

  private async performSync(
    doc: StudioDocumentDocument,
    quotation: QuotationDocument,
  ): Promise<QuotationDocument> {
    const quotationId = quotation._id.toString();
    const blocks = await this.blockService.findAllByStudioDocument(doc._id.toString());
    const resolved = await this.dataResolver.resolveDataSets(doc, blocks, true);
    const items = this.extractItemsFromDataSets(resolved, doc.context ?? {});

    const counterpartyId =
      typeof doc.context?.['counterpartyId'] === 'string'
        ? doc.context['counterpartyId']
        : undefined;

    return this.quotationService.update(quotationId, {
      items: items.map((item) => ({
        lineKind: item.lineKind,
        productId: item.productId?.toString(),
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        sortOrder: item.sortOrder,
      })),
      ...(counterpartyId ? { counterpartyId } : {}),
    });
  }

  async updateQuotationStatus(
    doc: StudioDocumentDocument,
    status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled',
    organizationId: string,
  ): Promise<QuotationDocument> {
    const { quotation } = await this.ensureLinkedQuotation(doc, organizationId);
    if (!quotation) {
      throw new NotFoundException('Document is not a KP type or quotation could not be created');
    }
    await this.syncQuotationItems(doc, organizationId);
    return this.quotationService.update(quotation._id.toString(), { status });
  }

  private assertQuotationOrg(
    quotation: QuotationDocument,
    organizationId: string,
  ): void {
    if (quotationOrgRefId(quotation.organizationId) !== organizationId) {
      // «Не палим существование чужого ресурса» — same pattern as OrgScopeGuard.
      throw new NotFoundException('Quotation not found');
    }
  }

  private extractItemsFromDataSets(
    dataSets: Record<string, unknown>[],
    context: Record<string, unknown>,
  ): QuotationItem[] {
    const selections = (context['catalogSelections'] as Record<string, unknown> | undefined) ?? {};
    const productIds = Array.isArray(selections['products'])
      ? selections['products'].filter((id): id is string => typeof id === 'string')
      : [];

    if (productIds.length > 0) {
      return productIds.map((productId, index) => ({
        lineKind: 'catalog' as const,
        productId: new Types.ObjectId(productId),
        quantity: 1,
        unitPrice: 0,
        total: 0,
        sortOrder: index,
        markupPercent: 0,
        discountPercent: 0,
        isOptional: false,
      }));
    }

    const items: QuotationItem[] = [];
    for (const entry of dataSets) {
      const rows = entry['rows'];
      if (!Array.isArray(rows)) continue;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (!Array.isArray(row) || row.length === 0) continue;
        const name = String(row[0] ?? '').trim();
        if (!name) continue;
        const qty = Number.parseFloat(String(row[1] ?? '1')) || 1;
        const price = Number.parseFloat(String(row[2] ?? '0')) || 0;
        items.push({
          lineKind: 'custom',
          productName: name,
          quantity: qty,
          unitPrice: price,
          total: qty * price,
          sortOrder: items.length,
          markupPercent: 0,
          discountPercent: 0,
          isOptional: false,
        } as QuotationItem);
      }
    }
    return items;
  }
}
