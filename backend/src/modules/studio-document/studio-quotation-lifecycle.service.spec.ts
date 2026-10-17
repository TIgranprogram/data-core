import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DocType } from '../doc-type/doc-type.schema';
import { QuotationService } from '../quotation/quotation.service';
import { TemplateBlockService } from '../template-block/template-block.service';
import { StudioDataResolverService } from './studio-data-resolver';
import { StudioQuotationLifecycleService } from './studio-quotation-lifecycle.service';
import type { StudioDocumentDocument } from './studio-document.schema';

describe('StudioQuotationLifecycleService (S20)', () => {
  let service: StudioQuotationLifecycleService;
  const proposalDocTypeId = new Types.ObjectId();
  const orgId = new Types.ObjectId().toString();

  const docTypeModel = {
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ slug: 'proposal' }),
      }),
    }),
  };

  const quotationService = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const blockService = {
    findAllByStudioDocument: jest.fn().mockResolvedValue([]),
  };

  const dataResolver = {
    resolveDataSets: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudioQuotationLifecycleService,
        { provide: getModelToken(DocType.name), useValue: docTypeModel },
        { provide: QuotationService, useValue: quotationService },
        { provide: TemplateBlockService, useValue: blockService },
        { provide: StudioDataResolverService, useValue: dataResolver },
      ],
    }).compile();

    service = module.get(StudioQuotationLifecycleService);
  });

  it('creates draft quotation for KP doc without link', async () => {
    const quotationId = new Types.ObjectId();
    quotationService.create.mockResolvedValue({ _id: quotationId, status: 'draft' });
    const save = jest.fn().mockResolvedValue(undefined);
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      context: {},
      save,
    } as unknown as StudioDocumentDocument;

    const result = await service.ensureLinkedQuotation(doc, orgId);

    expect(quotationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        status: 'draft',
        studioDocumentId: String(doc._id),
      }),
    );
    expect(result.quotation?._id).toEqual(quotationId);
    expect(save).toHaveBeenCalled();
  });

  it('skips non-KP documents', async () => {
    docTypeModel.findById.mockReturnValueOnce({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ slug: 'invoice' }),
      }),
    });
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: new Types.ObjectId(),
      context: {},
      save: jest.fn(),
    } as unknown as StudioDocumentDocument;

    const result = await service.ensureLinkedQuotation(doc, orgId);

    expect(quotationService.create).not.toHaveBeenCalled();
    expect(result.quotation).toBeNull();
  });

  it('returns existing linked quotation when its org matches the caller', async () => {
    const quotationId = new Types.ObjectId();
    const linked = {
      _id: quotationId,
      organizationId: new Types.ObjectId(orgId),
      status: 'draft',
    };
    quotationService.findById.mockResolvedValue(linked);
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: quotationId,
      context: {},
      save: jest.fn(),
    } as unknown as StudioDocumentDocument;

    const result = await service.ensureLinkedQuotation(doc, orgId);

    expect(quotationService.findById).toHaveBeenCalledWith(quotationId.toString());
    expect(result.quotation).toBe(linked);
    expect(quotationService.create).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the linked quotation belongs to another org', async () => {
    const quotationId = new Types.ObjectId();
    quotationService.findById.mockResolvedValue({
      _id: quotationId,
      organizationId: new Types.ObjectId(),
      status: 'draft',
    });
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: quotationId,
      context: {},
      save: jest.fn(),
    } as unknown as StudioDocumentDocument;

    await expect(service.ensureLinkedQuotation(doc, orgId)).rejects.toThrow(
      NotFoundException,
    );
    expect(quotationService.create).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('accepts a populated org document (findById shape) when it matches', async () => {
    const quotationId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: quotationId,
      context: {},
      save: jest.fn(),
    } as unknown as StudioDocumentDocument;
    quotationService.findById.mockResolvedValue({
      _id: quotationId,
      organizationId: { _id: new Types.ObjectId(orgId), shortName: 'Acme' },
      status: 'draft',
    });

    const result = await service.ensureLinkedQuotation(doc, orgId);

    expect(result.quotation?._id).toEqual(quotationId);
  });

  it('syncQuotationItems heals a cross-org linkedQuotationId (KP doc): clears the dead FK, creates a fresh draft, and syncs — no 404', async () => {
    const deadQuotationId = new Types.ObjectId();
    const freshQuotationId = new Types.ObjectId();
    const freshQuotation = {
      _id: freshQuotationId,
      organizationId: new Types.ObjectId(orgId),
      status: 'draft',
    };
    quotationService.findById.mockResolvedValue({
      _id: deadQuotationId,
      organizationId: new Types.ObjectId(), // foreign org
      status: 'draft',
    });
    quotationService.create.mockResolvedValue(freshQuotation);
    quotationService.update.mockResolvedValue(freshQuotation);
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: deadQuotationId,
      context: { quotationId: deadQuotationId.toString(), counterpartyId: 'cust-1' },
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as StudioDocumentDocument;

    const result = await service.syncQuotationItems(doc, orgId);

    expect(doc.linkedQuotationId).toEqual(freshQuotationId);
    expect(doc.context['quotationId']).toBe(freshQuotationId.toString());
    expect(doc.save).toHaveBeenCalled();
    expect(quotationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, status: 'draft', counterpartyId: 'cust-1' }),
    );
    expect(quotationService.update).toHaveBeenCalledWith(
      freshQuotationId.toString(),
      expect.objectContaining({ items: [] }),
    );
    expect(result).toBe(freshQuotation);
  });

  it('syncQuotationItems heals a deleted linkedQuotationId (KP doc, findById 404): same recovery, no throw', async () => {
    const deadQuotationId = new Types.ObjectId();
    const freshQuotationId = new Types.ObjectId();
    const freshQuotation = {
      _id: freshQuotationId,
      organizationId: new Types.ObjectId(orgId),
      status: 'draft',
    };
    quotationService.findById.mockRejectedValue(
      new NotFoundException(`Quotation ${deadQuotationId.toString()} not found`),
    );
    quotationService.create.mockResolvedValue(freshQuotation);
    quotationService.update.mockResolvedValue(freshQuotation);
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: deadQuotationId,
      context: { quotationId: deadQuotationId.toString() },
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as StudioDocumentDocument;

    const result = await service.syncQuotationItems(doc, orgId);

    expect(result).toBe(freshQuotation);
    expect(quotationService.create).toHaveBeenCalled();
  });

  it('syncQuotationItems heals a dead linkedQuotationId on a non-KP doc by clearing the FK and returning null (not 404)', async () => {
    docTypeModel.findById.mockReturnValueOnce({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ slug: 'invoice' }),
      }),
    });
    const deadQuotationId = new Types.ObjectId();
    quotationService.findById.mockRejectedValue(
      new NotFoundException(`Quotation ${deadQuotationId.toString()} not found`),
    );
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: deadQuotationId,
      context: { quotationId: deadQuotationId.toString() },
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as StudioDocumentDocument;

    const result = await service.syncQuotationItems(doc, orgId);

    expect(result).toBeNull();
    expect(doc.linkedQuotationId).toBeUndefined();
    expect(doc.context['quotationId']).toBeUndefined();
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(quotationService.create).not.toHaveBeenCalled();
    expect(quotationService.update).not.toHaveBeenCalled();
  });

  it('syncQuotationItems syncs items when the quotation org matches', async () => {
    const quotationId = new Types.ObjectId();
    const quotation = {
      _id: quotationId,
      organizationId: new Types.ObjectId(orgId),
      status: 'draft',
    };
    quotationService.findById.mockResolvedValue(quotation);
    quotationService.update.mockResolvedValue(quotation);
    const doc = {
      _id: new Types.ObjectId(),
      docTypeId: proposalDocTypeId,
      organizationId: new Types.ObjectId(orgId),
      linkedQuotationId: quotationId,
      context: {},
      save: jest.fn(),
    } as unknown as StudioDocumentDocument;

    const result = await service.syncQuotationItems(doc, orgId);

    expect(quotationService.update).toHaveBeenCalledWith(
      quotationId.toString(),
      expect.objectContaining({ items: [] }),
    );
    expect(result).toBe(quotation);
  });
});
