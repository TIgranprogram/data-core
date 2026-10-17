import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MutationJournalService } from './mutation-journal.service';

function buildService(opts: {
  create?: jest.Mock;
  findByIdDoc?: any;
  findById?: jest.Mock;
  findOne?: jest.Mock;
  countDocuments?: jest.Mock;
  deleteMany?: jest.Mock;
  materialsCreate?: jest.Mock;
  materialsUpdate?: jest.Mock;
  materialsRemove?: jest.Mock;
  materialsFindById?: jest.Mock;
  productsCreate?: jest.Mock;
  productsUpdate?: jest.Mock;
  productsRemove?: jest.Mock;
  productsFindById?: jest.Mock;
  counterpartiesCreate?: jest.Mock;
  counterpartiesRemove?: jest.Mock;
  sitesCreate?: jest.Mock;
  sitesRemove?: jest.Mock;
  ordersCreate?: jest.Mock;
  ordersRemove?: jest.Mock;
  ringSize?: number;
} = {}) {
  const create = opts.create ?? jest.fn();
  const findOne = opts.findOne ?? jest.fn();
  const countDocuments = opts.countDocuments ?? jest.fn().mockResolvedValue(0);
  const deleteMany = opts.deleteMany ?? jest.fn().mockResolvedValue({ deletedCount: 0 });

  const leanChain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const findById =
    opts.findById ??
    jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockResolvedValue(opts.findByIdDoc ?? null),
    }));

  const model = {
    create,
    findById,
    findOne: jest.fn().mockImplementation(() => ({
      sort: jest.fn().mockReturnThis(),
      exec: findOne,
    })),
    find: jest.fn().mockReturnValue(leanChain),
    countDocuments: jest.fn(() => ({ exec: countDocuments })),
    deleteMany: jest.fn(() => ({ exec: deleteMany })),
  } as any;

  const materials = {
    create: opts.materialsCreate ?? jest.fn(),
    update: opts.materialsUpdate ?? jest.fn(),
    remove: opts.materialsRemove ?? jest.fn(),
    findById: opts.materialsFindById ?? jest.fn(),
  } as any;

  const products = {
    create: opts.productsCreate ?? jest.fn(),
    update: opts.productsUpdate ?? jest.fn(),
    remove: opts.productsRemove ?? jest.fn(),
    findById: opts.productsFindById ?? jest.fn(),
  } as any;

  const counterparties = {
    create: opts.counterpartiesCreate ?? jest.fn(),
    remove: opts.counterpartiesRemove ?? jest.fn(),
  } as any;

  const sites = {
    create: opts.sitesCreate ?? jest.fn(),
    remove: opts.sitesRemove ?? jest.fn(),
  } as any;

  const orders = {
    create: opts.ordersCreate ?? jest.fn(),
    remove: opts.ordersRemove ?? jest.fn(),
  } as any;

  process.env.MUTATION_JOURNAL_RING_SIZE = String(opts.ringSize ?? 50);
  const service = new MutationJournalService(model, materials, products, counterparties, sites, orders);
  return {
    service,
    create,
    findById,
    findOne,
    materials,
    products,
    counterparties,
    sites,
    orders,
    model,
    leanChain,
    countDocuments,
    deleteMany,
  };
}

const user = {
  id: '507f1f77bcf86cd799439011',
  username: 'mgr',
  role: 'manager',
  organizationId: '507f1f77bcf86cd799439022',
};

describe('MutationJournalService (TZD-13)', () => {
  it('propose material.create does not call MaterialService.create', async () => {
    const { service, create, materials } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'proposed',
        kind: 'material.create',
        toolName: 'kppdf_propose_material_create',
        payload: { name: 'Oak' },
        entityType: 'Material',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    const view = await service.propose(
      { kind: 'material.create', create: { name: 'Oak', unit: 'шт' } },
      user,
    );
    expect(view.proposalId).toBe('507f1f77bcf86cd799439033');
    expect(view.status).toBe('proposed');
    expect(materials.create).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('propose material.create stores extended fields in payload (TZD-32)', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'proposed',
        kind: 'material.create',
        toolName: 'kppdf_propose_material_create',
        payload: {},
        entityType: 'Material',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    await service.propose(
      {
        kind: 'material.create',
        create: {
          name: 'Стекло 4мм',
          unit: 'м2',
          pricePerUnit: 420,
          materialKind: 'purchased',
          description: 'Полированное',
          dimensions: [{ type: 'thickness', value: 4 }],
        },
      },
      user,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          name: 'Стекло 4мм',
          unit: 'м2',
          pricePerUnit: 420,
          materialKind: 'purchased',
          description: 'Полированное',
          dimensions: [{ type: 'thickness', value: 4 }],
        }),
      }),
    );
  });

  it('confirm material.create passes pricePerUnit/kind/description/dimensions to MaterialService.create (TZD-32)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'proposed',
      kind: 'material.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      payload: {
        name: 'Стекло 4мм',
        unit: 'м2',
        pricePerUnit: 420,
        materialKind: 'purchased',
        description: 'Полированное',
        dimensions: [{ type: 'thickness', value: 4 }],
      },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, materials } = buildService({
      findByIdDoc: doc,
      materialsCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439044',
        name: 'Стекло 4мм',
        pricePerUnit: 420,
        toObject: () => ({
          _id: '507f1f77bcf86cd799439044',
          name: 'Стекло 4мм',
          pricePerUnit: 420,
        }),
      }),
    });

    const view = await service.confirm('507f1f77bcf86cd799439033', user);
    expect(materials.create).toHaveBeenCalledWith({
      name: 'Стекло 4мм',
      unit: 'м2',
      pricePerUnit: 420,
      materialKind: 'purchased',
      description: 'Полированное',
      dimensions: [{ type: 'thickness', value: 4 }],
    });
    expect(doc.status).toBe('applied');
    expect(view.mutationId).toBe('507f1f77bcf86cd799439033');
  });

  it('regression: propose without extended fields stores only basic fields (TZD-32)', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'proposed',
        kind: 'material.create',
        toolName: 't',
        payload: {},
        entityType: 'Material',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    await service.propose(
      { kind: 'material.create', create: { name: 'Oak', unit: 'шт' } },
      user,
    );
    const payload = create.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload).toEqual({ name: 'Oak', unit: 'шт' });
    expect(payload).not.toHaveProperty('pricePerUnit');
    expect(payload).not.toHaveProperty('materialKind');
    expect(payload).not.toHaveProperty('dimensions');
  });

  it('confirm create applies material and marks applied', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'proposed',
      kind: 'material.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      payload: { name: 'Oak', unit: 'шт' },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, materials } = buildService({
      findByIdDoc: doc,
      materialsCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439044',
        name: 'Oak',
        toObject: () => ({ _id: '507f1f77bcf86cd799439044', name: 'Oak' }),
      }),
    });

    const view = await service.confirm('507f1f77bcf86cd799439033', user);
    expect(materials.create).toHaveBeenCalledWith({ name: 'Oak', unit: 'шт' });
    expect(doc.status).toBe('applied');
    expect(view.mutationId).toBe('507f1f77bcf86cd799439033');
    expect(save).toHaveBeenCalled();
  });

  it('undo create soft-deletes material', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'applied',
      kind: 'material.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      entityId: '507f1f77bcf86cd799439044',
      save,
    };
    const { service, materials } = buildService({
      findByIdDoc: doc,
      materialsRemove: jest.fn().mockResolvedValue(undefined),
    });

    await service.undo('507f1f77bcf86cd799439033', user);
    expect(materials.remove).toHaveBeenCalledWith('507f1f77bcf86cd799439044');
    expect(doc.status).toBe('undone');
  });

  it('rejects confirm of non-proposed', async () => {
    const { service } = buildService({
      findByIdDoc: {
        _id: '507f1f77bcf86cd799439033',
        status: 'applied',
        actorUserId: user.id,
        organizationId: user.organizationId,
      },
    });
    await expect(service.confirm('507f1f77bcf86cd799439033', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('confirm missing proposal returns 404 text with the received proposalId and recovery hint', async () => {
    const { service } = buildService({ findByIdDoc: null });

    const error = await service.confirm('507f1f77bcf86cd799439099', user).catch((err) => err);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain('507f1f77bcf86cd799439099');
    expect(error.message).toContain('proposalId');
    expect(error.message).toContain('kppdf_propose_*');
  });

  it('confirm rejects a proposal owned by another user with 403', async () => {
    const { service } = buildService({
      findByIdDoc: {
        _id: '507f1f77bcf86cd799439099',
        status: 'proposed',
        actorUserId: '507f1f77bcf86cd799439088',
        organizationId: user.organizationId,
      },
    });

    await expect(service.confirm('507f1f77bcf86cd799439099', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('confirm 100 proposals immediately after propose without a 404 regression', async () => {
    const makeDoc = (id: string) => ({
      _id: id,
      status: 'proposed',
      kind: 'material.create',
      toolName: 'kppdf_propose_material_create',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      payload: { name: `Material ${id}`, unit: 'шт' },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(undefined),
    });
    const findById = jest.fn().mockImplementation((id: string) => ({
      exec: jest.fn().mockResolvedValue(makeDoc(id)),
    }));
    const { service, materials } = buildService({
      findById,
      materialsCreate: jest.fn().mockImplementation((payload: { name: string }) =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439044',
          name: payload.name,
          toObject: () => ({ _id: '507f1f77bcf86cd799439044', name: payload.name }),
        }),
      ),
    });

    const ids = Array.from({ length: 100 }, (_, index) =>
      `507f1f77bcf86cd7994390${String(index).padStart(2, '0')}`,
    );
    for (const id of ids) {
      await expect(service.confirm(id, user)).resolves.toMatchObject({
        mutationId: id,
        status: 'applied',
      });
    }

    expect(findById).toHaveBeenCalledTimes(100);
    expect(materials.create).toHaveBeenCalledTimes(100);
  });

  it('proposeBatch 50 items → 50 ids, no SoT writes (TZD-18)', async () => {
    const { service, materials, create } = buildService({
      create: jest.fn().mockImplementation(() =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439100',
          status: 'proposed',
          kind: 'material.create',
          toolName: 'kppdf_propose_material_batch',
          entityType: 'Material',
          payload: { name: 'X' },
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
      findById: jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(null),
      })),
    });

    const items = Array.from({ length: 50 }, (_, i) => ({
      kind: 'material.create' as const,
      create: { name: `M${i}` },
    }));
    const result = await service.proposeBatch({ items }, user);

    expect(result.proposalIds).toHaveLength(50);
    expect(result.errors).toEqual([]);
    expect(materials.create).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(50);
  });

  it('proposeBatch rolls back created proposals on item error (TZD-18)', async () => {
    const createdDoc: any = {
      _id: '507f1f77bcf86cd799439100',
      status: 'proposed',
      kind: 'material.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      payload: { name: 'Good' },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    };
    const { service, create } = buildService({
      create: jest.fn().mockImplementation(() =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439100',
          status: 'proposed',
          kind: 'material.create',
          toolName: 't',
          actorUserId: user.id,
          organizationId: user.organizationId,
          entityType: 'Material',
          payload: { name: 'Good' },
          expiresAt: new Date(Date.now() + 60_000),
          toObject: () => ({ _id: '507f1f77bcf86cd799439100' }),
        }),
      ),
      findByIdDoc: createdDoc,
    });

    const result = await service.proposeBatch(
      {
        items: [
          { kind: 'material.create', create: { name: 'Good' } },
          // второй item падает: без имени
          { kind: 'material.create', create: { name: '  ' } },
        ],
      },
      user,
    );

    expect(result.proposalIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(createdDoc.status).toBe('cancelled'); // откат созданного
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('proposeBatch idempotencyKey returns existing proposals on retry (TZD-18)', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockImplementation(() =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439200',
          status: 'proposed',
          kind: 'material.create',
          toolName: 't',
          entityType: 'Material',
          payload: { name: 'X' },
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    });
    const leanChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValueOnce([{ _id: '507f1f77bcf86cd799439200' }])
        .mockResolvedValueOnce([]),
    };
    (service as any).model.find = jest.fn().mockReturnValue(leanChain);

    const first = await service.proposeBatch(
      { items: [{ kind: 'material.create', create: { name: 'X' } }], idempotencyKey: 'k1' },
      user,
    );
    expect(first.proposalIds).toEqual(['507f1f77bcf86cd799439200']);
    expect(first.note).toContain('idempotency hit');
    expect(create).not.toHaveBeenCalled();
  });

  it('confirmBatch applies materials; cancelBatch does not write SoT (TZD-18)', async () => {
    const makeDoc = (id: string) => {
      const doc: any = {
        _id: id,
        status: 'proposed',
        kind: 'material.create',
        toolName: 't',
        actorUserId: user.id,
        organizationId: user.organizationId,
        entityType: 'Material',
        payload: { name: 'Oak', unit: 'шт' },
        expiresAt: new Date(Date.now() + 60_000),
        save: jest.fn(),
      };
      return doc;
    };
    const doc1 = makeDoc('507f1f77bcf86cd799439301');
    const doc2 = makeDoc('507f1f77bcf86cd799439302');
    const doc3 = makeDoc('507f1f77bcf86cd799439303');
    const findById = jest.fn().mockImplementation((id: string) => ({
      exec: jest.fn().mockResolvedValue(
        id === '507f1f77bcf86cd799439301'
          ? doc1
          : id === '507f1f77bcf86cd799439302'
            ? doc2
            : doc3,
      ),
    }));
    const { service, materials } = buildService({
      findById,
      materialsCreate: jest.fn().mockImplementation((p: any) =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439400',
          name: p.name,
          toObject: () => ({ name: p.name }),
        }),
      ),
    });

    const confirmed = await service.confirmBatch(
      {
        ids: [
          '507f1f77bcf86cd799439301',
          '507f1f77bcf86cd799439302',
        ],
      },
      user,
    );
    expect(confirmed.applied).toBe(2);
    expect(confirmed.failed).toEqual([]);
    expect(materials.create).toHaveBeenCalledTimes(2);
    expect(doc1.status).toBe('applied');

    const cancelled = await service.cancelBatch(
      { ids: ['507f1f77bcf86cd799439303'] },
      user,
    );
    expect(cancelled.cancelled).toBe(1);
    expect(doc3.status).toBe('cancelled');
    expect(materials.create).toHaveBeenCalledTimes(2); // cancel не пишет SoT
  });

  it('propose product.create → journal row, Product count unchanged (TZD-27)', async () => {
    const { service, create, products } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'proposed',
        kind: 'product.create',
        toolName: 'kppdf_propose_product_create',
        entityType: 'Product',
        payload: { name: 'Окно ПВХ', kind: 'good', unit: 'шт' },
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    const view = await service.propose(
      {
        kind: 'product.create',
        productCreate: { name: 'Окно ПВХ', kind: 'good' },
      },
      user,
    );
    expect(view.proposalId).toBe('507f1f77bcf86cd799439033');
    expect(view.status).toBe('proposed');
    expect(products.create).not.toHaveBeenCalled(); // не ProductService.create до confirm
    expect(create).toHaveBeenCalled();
  });

  it('propose product.create preserves categoryId and status in the journal payload (TZD-43)', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'proposed',
        kind: 'product.create',
        toolName: 'kppdf_propose_product_create',
        entityType: 'Product',
        payload: {},
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    await service.propose(
      {
        kind: 'product.create',
        productCreate: {
          name: 'ШЛ-300',
          kind: 'good',
          categoryId: '507f1f77bcf86cd799439011',
          status: 'active',
        },
      },
      user,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          categoryId: '507f1f77bcf86cd799439011',
          status: 'active',
        }),
      }),
    );
  });

  it('propose product.create rejects missing kind (TZD-27)', async () => {
    const { service } = buildService();
    await expect(
      service.propose(
        { kind: 'product.create', productCreate: { name: 'X' } as any },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm product.create → ProductService.create + applied (TZD-27)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'proposed',
      kind: 'product.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Product',
      payload: { name: 'Окно ПВХ', kind: 'good', unit: 'шт' },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, products } = buildService({
      findByIdDoc: doc,
      productsCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439044',
        name: 'Окно ПВХ',
        toObject: () => ({ _id: '507f1f77bcf86cd799439044', name: 'Окно ПВХ' }),
      }),
    });

    const view = await service.confirm('507f1f77bcf86cd799439033', user);
    expect(products.create).toHaveBeenCalledWith(
      { name: 'Окно ПВХ', kind: 'good', unit: 'шт' },
      user.organizationId,
    );
    expect(doc.status).toBe('applied');
    expect(view.mutationId).toBe('507f1f77bcf86cd799439033');
  });

  it('undo product.create → ProductService.remove (TZD-27)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'applied',
      kind: 'product.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Product',
      entityId: '507f1f77bcf86cd799439044',
      save,
    };
    const { service, products } = buildService({
      findByIdDoc: doc,
      productsRemove: jest.fn().mockResolvedValue(undefined),
    });

    await service.undo('507f1f77bcf86cd799439033', user);
    expect(products.remove).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439044',
      user.organizationId,
    );
    expect(doc.status).toBe('undone');
  });

  it('confirm product.update → ProductService.update with before snapshot (TZD-27)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'proposed',
      kind: 'product.update',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Product',
      entityId: '507f1f77bcf86cd799439044',
      payload: { id: '507f1f77bcf86cd799439044', patch: { notes: 'updated' } },
      before: { name: 'Окно', notes: 'old' },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, products } = buildService({
      findByIdDoc: doc,
      productsUpdate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439044',
        notes: 'updated',
        toObject: () => ({ _id: '507f1f77bcf86cd799439044', notes: 'updated' }),
      }),
    });

    await service.confirm('507f1f77bcf86cd799439033', user);
    expect(products.update).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439044',
      { notes: 'updated' },
      user.organizationId,
    );
    expect(doc.status).toBe('applied');
  });

  // ── TZD-ORDER-IMPORT-01 ─────────────────────────────────────────────────────

  it('propose counterparty.create → journal row, CounterpartyService.create not called', async () => {
    const { service, create, counterparties } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439055',
        status: 'proposed',
        kind: 'counterparty.create',
        toolName: 'kppdf_propose_counterparty_create',
        payload: { name: 'ООО «Дортранссервис»', inn: '7701234567', roles: ['customer'] },
      }),
    });

    const view = await service.propose(
      {
        kind: 'counterparty.create',
        counterpartyCreate: { name: 'ООО «Дортранссервис»', inn: '7701234567', roles: ['customer'] },
      } as any,
      user,
    );

    expect(counterparties.create).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proposed', kind: 'counterparty.create', entityType: 'Counterparty' }),
    );
    expect(view.proposalId).toBe('507f1f77bcf86cd799439055');
  });

  it('propose counterparty.create rejects missing inn', async () => {
    const { service } = buildService();
    await expect(
      service.propose(
        { kind: 'counterparty.create', counterpartyCreate: { name: 'X', roles: ['customer'] } as any } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm counterparty.create → CounterpartyService.create + applied', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439055',
      status: 'proposed',
      kind: 'counterparty.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Counterparty',
      payload: { name: 'ООО «Дортранссервис»', inn: '7701234567', roles: ['customer'] },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, counterparties } = buildService({
      findByIdDoc: doc,
      counterpartiesCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439066',
        toObject: () => ({ _id: '507f1f77bcf86cd799439066', name: 'ООО «Дортранссервис»' }),
      }),
    });

    const view = await service.confirm('507f1f77bcf86cd799439055', user);
    expect(counterparties.create).toHaveBeenCalledWith(doc.payload, { organizationId: user.organizationId });
    expect(doc.status).toBe('applied');
    expect(view.mutationId).toBe('507f1f77bcf86cd799439055');
  });

  it('undo counterparty.create → CounterpartyService.remove', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439055',
      status: 'applied',
      kind: 'counterparty.create',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Counterparty',
      entityId: '507f1f77bcf86cd799439066',
      save,
    };
    const { service, counterparties } = buildService({ findByIdDoc: doc });
    await service.undo('507f1f77bcf86cd799439055', user);
    expect(counterparties.remove).toHaveBeenCalledWith('507f1f77bcf86cd799439066', {
      organizationId: user.organizationId,
    });
    expect(doc.status).toBe('undone');
  });

  it('confirm site.create → SiteService.create + applied', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439077',
      status: 'proposed',
      kind: 'site.create',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Site',
      payload: { counterpartyId: '507f1f77bcf86cd799439066', name: 'Объект', address: 'г. Москва' },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, sites } = buildService({
      findByIdDoc: doc,
      sitesCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439088',
        toObject: () => ({ _id: '507f1f77bcf86cd799439088', name: 'Объект' }),
      }),
    });

    await service.confirm('507f1f77bcf86cd799439077', user);
    expect(sites.create).toHaveBeenCalledWith(doc.payload);
    expect(doc.status).toBe('applied');
  });

  it('propose order.create rejects item with quantity <= 0', async () => {
    const { service } = buildService();
    await expect(
      service.propose(
        {
          kind: 'order.create',
          orderCreate: {
            counterpartyId: '507f1f77bcf86cd799439066',
            siteId: '507f1f77bcf86cd799439088',
            items: [{ productId: '507f1f77bcf86cd799439099', quantity: 0 }],
          } as any,
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm order.create → OrderService.create with source=desktop-import + managerId=actor', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439100',
      status: 'proposed',
      kind: 'order.create',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Order',
      payload: {
        counterpartyId: '507f1f77bcf86cd799439066',
        siteId: '507f1f77bcf86cd799439088',
        items: [{ productId: '507f1f77bcf86cd799439099', quantity: 4, unit: 'шт' }],
      },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, orders } = buildService({
      findByIdDoc: doc,
      ordersCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439111',
        toObject: () => ({ _id: '507f1f77bcf86cd799439111', number: 'ORD-0099' }),
      }),
    });

    await service.confirm('507f1f77bcf86cd799439100', user);
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        counterpartyId: '507f1f77bcf86cd799439066',
        siteId: '507f1f77bcf86cd799439088',
        source: 'desktop-import',
        managerId: user.id,
      }),
    );
    expect(doc.status).toBe('applied');
  });

  it('undo order.create → OrderService.remove', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439100',
      status: 'applied',
      kind: 'order.create',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Order',
      entityId: '507f1f77bcf86cd799439111',
      save,
    };
    const { service, orders } = buildService({ findByIdDoc: doc });
    await service.undo('507f1f77bcf86cd799439100', user);
    expect(orders.remove).toHaveBeenCalledWith('507f1f77bcf86cd799439111');
    expect(doc.status).toBe('undone');
  });

  it('enforceRing deletes overflow', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'proposed',
      kind: 'material.create',
      toolName: 't',
      actorUserId: user.id,
      organizationId: user.organizationId,
      entityType: 'Material',
      payload: { name: 'X', unit: 'шт' },
      expiresAt: new Date(Date.now() + 60_000),
      save,
    };
    const { service, deleteMany, leanChain, materials } = buildService({
      findByIdDoc: doc,
      materialsCreate: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439044',
        toObject: () => ({ _id: '507f1f77bcf86cd799439044' }),
      }),
      ringSize: 2,
      countDocuments: jest.fn().mockResolvedValue(3),
    });
    leanChain.exec = jest.fn().mockResolvedValueOnce([{ _id: 'old1' }]);

    await service.confirm('507f1f77bcf86cd799439033', user);
    expect(deleteMany).toHaveBeenCalled();
    expect(materials.create).toHaveBeenCalled();
  });
});
