import { Types } from 'mongoose';
import { DocumentTemplateService } from './document-template.service';
import { DocumentRenderService } from '../document-render/document-render.service';
import { BLANK_A4_SENTINEL_TAG, BLANK_A4_TEMPLATE_NAME } from './blank-a4-template.constants';

const ORG = new Types.ObjectId();

function lookup<T>(value: T) {
  return { lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function findQuery<T>(value: T) {
  return { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

/** Build the service with mock models; only findAll/ensureBlankA4Sentinel are exercised. */
function createService(overrides: {
  modelOverrides?: Record<string, jest.Mock>;
  docTypeModel?: Record<string, jest.Mock>;
  categoryService?: Record<string, jest.Mock>;
} = {}) {
  const model = {
    find: jest.fn().mockReturnValue(findQuery([])),
    create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc })),
    updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    ...overrides.modelOverrides,
  };

  const docTypeModel = {
    findOne: jest.fn().mockReturnValue(findQuery({ _id: new Types.ObjectId(), slug: 'proposal' })),
    ...overrides.docTypeModel,
  };
  const categoryService = {
    assertAssignable: jest.fn(),
    resolveDefault: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    ...overrides.categoryService,
  };
  const blockModel = { find: jest.fn().mockReturnValue(lookup([])) };
  const quotationModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const contractModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orderModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orgModel = {};
  const counterpartyModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const productModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const materialModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const workTypeModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const textBlockModel = {};
  const counter = {};
  const tableTemplateService = {};

  const service = new DocumentTemplateService(
    model as never,
    blockModel as never,
    quotationModel as never,
    contractModel as never,
    orderModel as never,
    orgModel as never,
    counterpartyModel as never,
    productModel as never,
    materialModel as never,
    workTypeModel as never,
    textBlockModel as never,
    counter as never,
    tableTemplateService as never,
    categoryService as never,
    docTypeModel as never,
    new DocumentRenderService(),
  );
  return { service, model, docTypeModel, categoryService };
}

describe('DocumentTemplateService.findAll (TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM)', () => {
  it('always excludes soft-deleted rows and the blank-A4 sentinel tag', async () => {
    const find = jest.fn().mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
    const { service } = createService({ modelOverrides: { find } });

    await service.findAll();

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: null, tags: { $ne: BLANK_A4_SENTINEL_TAG } }),
    );
  });

  it('still applies org scope alongside the sentinel exclusion', async () => {
    const find = jest.fn().mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
    const { service } = createService({ modelOverrides: { find } });

    await service.findAll(ORG.toString());

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        tags: { $ne: BLANK_A4_SENTINEL_TAG },
        organizationId: expect.any(Types.ObjectId),
      }),
    );
  });
});

describe('DocumentTemplateService.ensureBlankA4Sentinel (TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM)', () => {
  it('no sentinel exists: creates one with the sentinel tag', async () => {
    const { service, model } = createService({ modelOverrides: { find: jest.fn().mockReturnValue(findQuery([])) } });

    const result = await service.ensureBlankA4Sentinel(ORG.toString());

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: BLANK_A4_TEMPLATE_NAME, tags: [BLANK_A4_SENTINEL_TAG] }),
    );
    expect(result.tags).toEqual([BLANK_A4_SENTINEL_TAG]);
  });

  it('exactly one sentinel exists: returns it, does not create or dedupe', async () => {
    const existing = { _id: new Types.ObjectId(), organizationId: ORG, tags: [BLANK_A4_SENTINEL_TAG] };
    const { service, model } = createService({ modelOverrides: { find: jest.fn().mockReturnValue(findQuery([existing])) } });

    const result = await service.ensureBlankA4Sentinel(ORG.toString());

    expect(result).toBe(existing);
    expect(model.create).not.toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('pre-existing duplicates (live-DB bug): keeps the oldest, soft-deletes the rest, does not create a third', async () => {
    const oldest = { _id: new Types.ObjectId(), organizationId: ORG, tags: [BLANK_A4_SENTINEL_TAG] };
    const dup = { _id: new Types.ObjectId(), organizationId: ORG, tags: [BLANK_A4_SENTINEL_TAG] };
    const { service, model } = createService({
      modelOverrides: { find: jest.fn().mockReturnValue(findQuery([oldest, dup])) },
    });

    const result = await service.ensureBlankA4Sentinel(ORG.toString());

    expect(result).toBe(oldest);
    expect(model.create).not.toHaveBeenCalled();
    expect(model.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [dup._id] } },
      { $set: { deletedAt: expect.any(Date) } },
    );
  });

  it('create races another writer (11000 duplicate key): re-finds instead of throwing', async () => {
    let call = 0;
    const winner = { _id: new Types.ObjectId(), organizationId: ORG, tags: [BLANK_A4_SENTINEL_TAG] };
    const find = jest.fn().mockImplementation(() => {
      call += 1;
      // First call (before create): nothing yet. Second call (after 11000): the other writer's row.
      return findQuery(call === 1 ? [] : [winner]);
    });
    const create = jest.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const { service } = createService({ modelOverrides: { find, create } });

    const result = await service.ensureBlankA4Sentinel(ORG.toString());

    expect(result).toBe(winner);
  });

  it('create fails for a reason other than a duplicate key: propagates the error', async () => {
    const find = jest.fn().mockReturnValue(findQuery([]));
    const create = jest.fn().mockRejectedValue(new Error('boom'));
    const { service } = createService({ modelOverrides: { find, create } });

    await expect(service.ensureBlankA4Sentinel(ORG.toString())).rejects.toThrow('boom');
  });
});
