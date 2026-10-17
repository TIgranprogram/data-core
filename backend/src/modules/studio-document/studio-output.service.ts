import {
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DocumentRenderService } from '../document-render/document-render.service';
import {
  planStudioMultipage,
} from '../document-render/studio-multipage.utils';
import {
  studioAggregateToRenderInput,
  type StudioDocumentAggregate,
} from '../document-render/studio-render.adapter';
import { GeneratedDocumentService } from '../generated-document/generated-document.service';
import { QuotationOutputService } from '../generated-document/quotation-output.service';
import { inlineLocalUploadsForPdf } from '../document-render/document-render.utils';
import { DocumentTemplateService } from '../document-template/document-template.service';
import { BLANK_A4_TEMPLATE_NAME } from '../document-template/blank-a4-template.constants';
import { TemplateBlockService } from '../template-block/template-block.service';
import { StudioDocumentService } from './studio-document.service';
import type { StudioDocumentDocument } from './studio-document.schema';
import {
  injectTableContent,
  StudioDataResolverService,
} from './studio-data-resolver';
import { applyTableAggregateTokensToBlocks } from './studio-table-tokens';

type OutputUser = Pick<AuthenticatedUser, 'organizationId'> & { id?: string };

export type StudioPreviewResult = {
  html: string;
  revision: number;
};

export type StudioFinalizeResult = {
  generatedDocument: Record<string, unknown>;
  studioDocument: StudioDocumentDocument;
};

/**
 * TZ-DOC-STUDIO Wave 9–10 — preview, finalize archive, PDF for studio documents.
 */
@Injectable()
export class StudioOutputService {
  constructor(
    private readonly studioService: StudioDocumentService,
    private readonly blockService: TemplateBlockService,
    private readonly renderService: DocumentRenderService,
    private readonly generatedDocuments: GeneratedDocumentService,
    private readonly pdfOutput: QuotationOutputService,
    private readonly dataResolver: StudioDataResolverService,
    private readonly templateService: DocumentTemplateService,
  ) {}

  async preview(id: string, user?: OutputUser): Promise<StudioPreviewResult> {
    const { html, doc } = await this.renderStudioDocument(id, user);
    // TZ-NX-DOCSTUDIO-PREVIEW-UPLOADS-INLINE — the preview iframe renders via
    // srcdoc, where a path-absolute /uploads/* <img src> does not reliably
    // resolve to the backend origin (broken icon) even though the same HTML
    // shows photos fine in the PDF, which already inlines uploads as data:
    // URIs before handing off to Puppeteer.
    const inlinedHtml = await inlineLocalUploadsForPdf(html);
    return { html: inlinedHtml, revision: doc.revision };
  }

  async finalize(id: string, user?: OutputUser): Promise<StudioFinalizeResult> {
    const doc = await this.studioService.findById(id, user?.organizationId);
    const sourceRevision = doc.revision;
    const blocks = await this.blockService.findAllByStudioDocument(id);
    const bakedDataSets = await this.dataResolver.bakeSnapshot(doc, blocks);
    const frozenDoc = await this.studioService.update(
      id,
      {
        expectedRevision: doc.revision,
        status: 'frozen',
        dataSets: bakedDataSets,
      },
      user?.organizationId,
      user?.id,
    );

    const { html, buildPayload } = await this.renderStudioDocument(id, user);
    const organizationId = String(frozenDoc.organizationId);

    const archiveTemplateId = frozenDoc.sourceTemplateId
      ? String(frozenDoc.sourceTemplateId)
      : String(
          (await this.templateService.ensureBlankA4Sentinel(organizationId))._id,
        );
    const archiveTemplateName = frozenDoc.sourceTemplateId
      ? frozenDoc.name
      : BLANK_A4_TEMPLATE_NAME;

    const generatedDocument = await this.generatedDocuments.archiveStudio({
      studioDocumentId: id,
      sourceRevision,
      templateId: archiveTemplateId,
      templateName: archiveTemplateName,
      name: frozenDoc.name,
      organizationId,
      html,
      buildPayload,
    });

    const updated = await this.studioService.update(
      id,
      {
        expectedRevision: frozenDoc.revision,
        status: 'final',
      },
      user?.organizationId,
      user?.id,
    );

    return {
      generatedDocument: generatedDocument.toObject() as unknown as Record<string, unknown>,
      studioDocument: updated,
    };
  }

  async renderPdf(
    id: string,
    user?: OutputUser,
  ): Promise<{ buffer: Buffer; name: string }> {
    const { html, doc } = await this.renderStudioDocument(id, user);
    const buffer = await this.pdfOutput.renderHtmlToPdf(html);
    return { buffer, name: doc.name };
  }

  private async renderStudioDocument(
    id: string,
    user?: OutputUser,
  ): Promise<{
    html: string;
    doc: StudioDocumentDocument;
    buildPayload: Record<string, unknown>;
  }> {
    const doc = await this.studioService.findById(id, user?.organizationId);
    const blocks = await this.blockService.findAllByStudioDocument(id);
    const dataSets = await this.dataResolver.resolveDataSets(doc, blocks, true);
    const vatPercent = await this.dataResolver.resolveOrganizationVatRate(String(doc.organizationId));
    const tableBlocks = injectTableContent(blocks, dataSets as never, vatPercent);
    const renderedBlocks = applyTableAggregateTokensToBlocks(tableBlocks, dataSets, vatPercent);
    const aggregate: StudioDocumentAggregate = {
      document: {
        name: doc.name,
        pageSize: doc.pageSize as StudioDocumentAggregate['document']['pageSize'],
        orientation: doc.orientation,
        backgroundImage: doc.backgroundImage,
        defaultBackgroundIndex: doc.defaultBackgroundIndex,
        backgroundPageIndices: doc.backgroundPageIndices,
        backgroundOpacity: doc.backgroundOpacity,
        pageMargins: doc.pageMargins,
        sheetLayout: doc.sheetLayout,
        pageNumbering: doc.pageNumbering,
        manualPageCount: doc.manualPageCount,
      },
      blocks: renderedBlocks,
      buildDto: {
        organizationId: String(doc.organizationId),
      },
      dataSets: dataSets,
    };

    // TZ-NX-DOCSTUDIO-S8-1 — hydrate the substitution bag from doc.context
    // (counterpartyId/quotationId/orderId) so {{counterparty.*}} and similar
    // tokens resolve to real DB values in preview/PDF. Editor stays raw.
    try {
      const ctx = doc.context ?? {};
      const buildDto: Record<string, unknown> = {
        organizationId: String(doc.organizationId),
      };
      const contextKeys = [
        'counterpartyId',
        'quotationId',
        'orderId',
        'contractId',
        'contactPersonId',
        'siteId',
      ];
      for (const key of contextKeys) {
        const val = ctx[key];
        if (typeof val === "string" && val.trim() && Types.ObjectId.isValid(val.trim())) {
          buildDto[key] = val.trim();
        }
      }
      aggregate["data"] = await this.templateService.buildSubstitutionBag({
        ...buildDto,
        anchors: (ctx['anchors'] as Record<string, unknown> | undefined) ?? {},
      });
    } catch {
      // hydration is best-effort: render proceeds with the stub bag
    }

    const input = studioAggregateToRenderInput(aggregate);
    const pagePlan = planStudioMultipage({
      blocks: input.blocks,
      manualPageCount: doc.manualPageCount ?? 1,
      dataSets,
      backgroundImages: doc.backgroundImage ?? [],
      defaultBackgroundIndex: doc.defaultBackgroundIndex ?? -1,
      backgroundPageIndices: doc.backgroundPageIndices,
      sheetLayout: doc.sheetLayout,
    });
    const pageBlocks = pagePlan.map((page) => page.blocks);
    const backgroundPageIndices = pagePlan.map((page) =>
      page.backgroundIndex >= 0 ? page.backgroundIndex : undefined,
    );
    const html =
      pageBlocks.length <= 1
        ? this.renderService.renderHtml(
            input.template,
            pageBlocks[0] ?? [],
            input.data,
            { backgroundPageIndex: backgroundPageIndices[0], studioCanvas: true, pageMargins: doc.pageMargins },
          )
        : this.renderService.renderHtmlPages(input.template, pageBlocks, input.data, {
            backgroundPageIndices: backgroundPageIndices.map((idx) => idx ?? -1),
            studioCanvas: true,
            pageMargins: doc.pageMargins,
          });
    const buildPayload: Record<string, unknown> = {
      studioDocumentId: id,
      revision: doc.revision,
      organizationId: String(doc.organizationId),
    };
    return { html, doc, buildPayload };
  }
}
