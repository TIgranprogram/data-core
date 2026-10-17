import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { GeneratedDocumentService } from './generated-document.service';

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();
const TEMPLATE_ID = new Types.ObjectId();
const DOCUMENT_ID = new Types.ObjectId();

function chain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: DOCUMENT_ID,
    templateId: TEMPLATE_ID,
    organizationId: ORG_A,
    html: '<p>safe</p>',
    isActive: true,
    isNew: false,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function orgModelMock() {
  return {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ shortName: 'Demo' }),
    }),
  };
}

function makeService(
  model: Record<string, unknown>,
  templateService: Record<string, unknown>,
  counter: Record<string, unknown>,
) {
  return new GeneratedDocumentService(
    model as never,
    orgModelMock() as never,
    templateService as never,
    counter as never,
  );
}

describe('GeneratedDocumentService organization scope', () => {
  it('filters list and detail reads to the authenticated organization plus global records', async () => {
    const model = {
      find: jest.fn().mockReturnValue(chain([])),
      findOne: jest.fn().mockReturnValue(chain(makeDocument())),
    };
    const templateService = { findById: jest.fn(), build: jest.fn() };
    const counter = { next: jest.fn() };
    const service = makeService(model, templateService, counter);

    await service.findAll({}, { organizationId: ORG_A.toString() });
    await service.findById(DOCUMENT_ID.toString(), { organizationId: ORG_A.toString() });

    const listFilter = model.find.mock.calls[0][0] as Record<string, unknown>;
    const detailFilter = model.findOne.mock.calls[0][0] as Record<string, unknown>;
    expect(listFilter.$or).toEqual([
      { organizationId: ORG_A },
      { organizationId: null },
      { organizationId: { $exists: false } },
    ]);
    expect(detailFilter.$or).toEqual(listFilter.$or);
  });

  it('rejects cross-organization HTML reads and deletes before a write', async () => {
    const foreignDocument = makeDocument({ organizationId: ORG_B });
    const model = {
      find: jest.fn(),
      findOne: jest.fn().mockImplementation((filter: Record<string, unknown>) =>
        filter.$or ? chain(null) : chain(foreignDocument),
      ),
      create: jest.fn(),
    };
    const service = makeService(
      model,
      {
        findById: jest.fn(),
        assertBuildSourcesInOrganization: jest.fn(),
        build: jest.fn(),
      },
      { next: jest.fn() },
    );

    await expect(
      service.findById(DOCUMENT_ID.toString(), { organizationId: ORG_A.toString() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.remove(DOCUMENT_ID.toString(), { organizationId: ORG_A.toString() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(foreignDocument.save).not.toHaveBeenCalled();
  });

  it('rejects a foreign template and ignores a foreign dto organization before create', async () => {
    const model = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    const templateService = {
      findById: jest.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: 'Foreign template',
        organizationId: ORG_B,
      }),
      assertBuildSourcesInOrganization: jest.fn(),
      build: jest.fn(),
    };
    const service = makeService(model, templateService, { next: jest.fn() });

    await expect(
      service.generate(
        TEMPLATE_ID.toString(),
        { organizationId: ORG_A.toString() },
        undefined,
        { organizationId: ORG_A.toString() },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(templateService.build).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();

    templateService.findById.mockResolvedValue({
      _id: TEMPLATE_ID,
      name: 'Org A template',
      organizationId: ORG_A,
    });
    templateService.build.mockResolvedValue('<p>safe</p>');

    await expect(
      service.generate(
        TEMPLATE_ID.toString(),
        { organizationId: ORG_B.toString() },
        undefined,
        { organizationId: ORG_A.toString() },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects a foreign build source before rendering or persistence', async () => {
    const model = { create: jest.fn(), findOne: jest.fn(), find: jest.fn() };
    const templateService = {
      findById: jest.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: 'Org A template',
        organizationId: ORG_A,
      }),
      assertBuildSourcesInOrganization: jest.fn().mockRejectedValue(
        new NotFoundException('Source not found'),
      ),
      build: jest.fn(),
    };
    const service = makeService(model, templateService, { next: jest.fn() });

    await expect(
      service.generate(
        TEMPLATE_ID.toString(),
        { contractId: new Types.ObjectId().toString() },
        undefined,
        { organizationId: ORG_A.toString() },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(templateService.build).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('allows same-organization generation and delete writes', async () => {
    const document = makeDocument({ organizationId: ORG_A });
    const model = {
      create: jest.fn().mockResolvedValue(document),
      findOne: jest.fn().mockReturnValue(chain(document)),
      find: jest.fn(),
    };
    const templateService = {
      findById: jest.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: 'Org A template',
        organizationId: ORG_A,
      }),
      assertBuildSourcesInOrganization: jest.fn().mockResolvedValue(undefined),
      build: jest.fn().mockResolvedValue('<p>safe</p>'),
    };
    const counter = { next: jest.fn().mockResolvedValue('DOC-1') };
    const service = makeService(model, templateService, counter);

    await service.generate(
      TEMPLATE_ID.toString(),
      { organizationId: ORG_A.toString() },
      undefined,
      { organizationId: ORG_A.toString() },
    );
    await service.remove(DOCUMENT_ID.toString(), { organizationId: ORG_A.toString() });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
    expect(document.save).toHaveBeenCalledTimes(1);
  });

  it('does not allow an organization user to delete a global document', async () => {
    const document = makeDocument({ organizationId: null });
    const model = {
      findOne: jest.fn().mockReturnValue(chain(document)),
      find: jest.fn(),
    };
    const service = makeService(
      model,
      {
        findById: jest.fn(),
        assertBuildSourcesInOrganization: jest.fn(),
        build: jest.fn(),
      },
      { next: jest.fn() },
    );

    await expect(
      service.remove(DOCUMENT_ID.toString(), { organizationId: ORG_A.toString() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(document.save).not.toHaveBeenCalled();
  });

  it('preserves system-user bypass for generation', async () => {
    const model = {
      create: jest.fn().mockResolvedValue(makeDocument({ organizationId: ORG_B })),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    const templateService = {
      findById: jest.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: 'System template',
        organizationId: ORG_B,
      }),
      build: jest.fn().mockResolvedValue('<p>safe</p>'),
    };
    const counter = { next: jest.fn().mockResolvedValue('DOC-1') };
    const service = makeService(model, templateService, counter);

    await service.generate(TEMPLATE_ID.toString(), {}, undefined, { organizationId: null });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_B }),
    );
  });
});

describe('GeneratedDocumentService archiveStudio (TZ-DOC-STUDIO-1801)', () => {
  it('uses SD-{orgShort} counter prefix for studio archives', async () => {
    const studioId = new Types.ObjectId();
    const templateId = new Types.ObjectId();
    const orgId = new Types.ObjectId();
    const model = { create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const counter = { next: jest.fn().mockResolvedValue('SD-DEMO-2026-001') };
    const orgModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ shortName: 'Demo' }),
      }),
    };
    const service = new GeneratedDocumentService(
      model as never,
      orgModel as never,
      { findById: jest.fn() } as never,
      counter as never,
    );

    await service.archiveStudio({
      studioDocumentId: studioId.toString(),
      sourceRevision: 3,
      templateId: templateId.toString(),
      name: 'Archived',
      organizationId: orgId.toString(),
      html: '<p>snap</p>',
      buildPayload: {},
    });

    expect(counter.next).toHaveBeenCalledWith(
      'studio-generated-document',
      'SD-DEMO',
    );
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ number: 'SD-DEMO-2026-001' }),
    );
  });
});
