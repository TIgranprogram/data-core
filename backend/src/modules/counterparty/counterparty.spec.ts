import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CounterpartyService } from './counterparty.service';

describe('CounterpartyService (TZ-241 org-scoping)', () => {
  let service: CounterpartyService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeMockModel() {
    const findExec = jest.fn();
    const countExec = jest.fn();
    return {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: findExec,
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: countExec,
      }),
      _findExec: findExec,
      _countExec: countExec,
    };
  }

  it('findAll without user returns all non-deleted counterparties', async () => {
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    const result = await service.findAll();
    expect(result.items).toEqual([]);
    expect(mockModel.find).toHaveBeenCalledWith({ deletedAt: null });
  });

  it('findAll with org-scoped user filters by organizationId', async () => {
    const orgId = new Types.ObjectId().toString();
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    await service.findAll({}, { organizationId: orgId, role: 'admin' });

    const findCall = mockModel.find.mock.calls[0][0];
    expect(findCall.$or).toBeDefined();
    const orConditions = findCall.$or as Record<string, unknown>[];
    expect(
      orConditions.some(
        (c) => (c as Record<string, unknown>).organizationId !== undefined,
      ),
    ).toBe(true);
  });

  it('findAll with org-scoped user includes system and legacy records', async () => {
    const orgId = new Types.ObjectId().toString();
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    await service.findAll({}, { organizationId: orgId, role: 'admin' });

    const findCall = mockModel.find.mock.calls[0][0];
    const orConditions = findCall.$or as Record<string, unknown>[];
    expect(orConditions).toContainEqual({
      organizationId: null,
      isSystem: true,
    });
    expect(orConditions).toContainEqual({
      organizationId: { $exists: false },
    });
  });

  it('findAll with search and org scope combines both filters', async () => {
    const orgId = new Types.ObjectId().toString();
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    await service.findAll(
      { search: 'acme' },
      { organizationId: orgId, role: 'admin' },
    );

    const findCall = mockModel.find.mock.calls[0][0];
    expect(findCall.$and).toBeDefined();
    const andConditions = findCall.$and as Record<string, unknown>[];
    expect(andConditions).toHaveLength(2);
    expect((andConditions[0] as Record<string, unknown>).$or).toBeDefined();
    expect((andConditions[1] as Record<string, unknown>).$or).toBeDefined();
    expect(mockModel.countDocuments).toHaveBeenCalledWith(findCall);
  });

  it('findAll without org scope does not add org-scoping to $or', async () => {
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    await service.findAll({ search: 'acme' });

    const findCall = mockModel.find.mock.calls[0][0];
    expect(findCall.$or).toBeDefined();
    const orConditions = findCall.$or as Record<string, unknown>[];
    for (const cond of orConditions) {
      expect((cond as Record<string, unknown>).organizationId).toBeUndefined();
      expect((cond as Record<string, unknown>).isSystem).toBeUndefined();
    }
    expect(findCall.$and).toBeUndefined();
  });

  it('findAll defaults limit to 50 and clamps to 200', async () => {
    const mockModel = makeMockModel();
    service = new CounterpartyService(mockModel as any, { create: jest.fn() } as any);
    mockModel._findExec.mockResolvedValue([]);
    mockModel._countExec.mockResolvedValue(0);

    const defaulted = await service.findAll();
    expect(defaulted.limit).toBe(50);

    const clamped = await service.findAll({ limit: 500 });
    expect(clamped.limit).toBe(200);
  });
});

describe('CounterpartyService (TZ-PARTY-301 tenant hygiene)', () => {
  const ownOrgId = new Types.ObjectId().toString();
  const otherOrgId = new Types.ObjectId().toString();

  function makeModel(doc: unknown) {
    return {
      create: jest
        .fn()
        .mockImplementation((payload: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), ...payload }),
        ),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
  }

  function makeDoc(organizationId: string | null, extra: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      inn: '7701234567',
      innIsStub: true,
      organizationId: organizationId ? new Types.ObjectId(organizationId) : undefined,
      save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
      }),
      ...extra,
    };
  }

  it('create stamps organizationId from the JWT and ignores the body', async () => {
    const model = makeModel(null);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.create(
      {
        name: 'ООО Ромашка',
        roles: ['customer'],
        inn: '7701234567',
        organizationId: otherOrgId,
        isSystem: true,
      } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    const payload = model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(String(payload.organizationId)).toBe(ownOrgId);
    expect(payload.isSystem).toBe(false);
    expect(payload.innIsStub).toBe(false);
  });

  it('quickCreateParty always stamps the user organization and flags the stub INN', async () => {
    const model = makeModel(null);
    const sites = { create: jest.fn().mockResolvedValue({ _id: 'site-1' }) };
    const service = new CounterpartyService(model as any, sites as any);

    const { counterparty } = await service.quickCreateParty(
      { name: 'Иванов', address: 'Краснодар, ул. Мира 1' } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    const payload = counterparty as unknown as Record<string, unknown>;
    expect(String(payload.organizationId)).toBe(ownOrgId);
    expect(payload.innIsStub).toBe(true);
    expect(payload.roles).toEqual(['customer']);
  });

  it('quickCreateParty checks INN clashes inside the tenant only', async () => {
    const model = makeModel(null);
    const service = new CounterpartyService(model as any, {
      create: jest.fn().mockResolvedValue({}),
    } as any);

    await service.quickCreateParty(
      { name: 'Иванов', address: 'Краснодар' } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    const clashFilter = model.findOne.mock.calls[0][0] as Record<string, unknown>;
    expect(String(clashFilter.organizationId)).toBe(ownOrgId);
    expect(clashFilter.inn).toBeDefined();
  });

  it('findById hides another tenant counterparty behind 404 (IDOR)', async () => {
    const model = makeModel(makeDoc(otherOrgId));
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await expect(
      service.findById(new Types.ObjectId().toString(), {
        organizationId: ownOrgId,
        role: 'manager',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findById returns own tenant counterparty and skips deleted rows', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    const id = new Types.ObjectId().toString();
    await expect(
      service.findById(id, { organizationId: ownOrgId, role: 'manager' }),
    ).resolves.toBe(doc);
    expect(model.findOne).toHaveBeenCalledWith({ _id: id, deletedAt: null });
  });

  it('findById still serves legacy records without organizationId', async () => {
    const doc = makeDoc(null);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await expect(
      service.findById(new Types.ObjectId().toString(), {
        organizationId: ownOrgId,
        role: 'manager',
      }),
    ).resolves.toBe(doc);
  });

  it('update cannot move a counterparty to another tenant', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.update(
      new Types.ObjectId().toString(),
      { organizationId: otherOrgId, name: 'Новое имя' } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    expect(String(doc.organizationId)).toBe(ownOrgId);
    expect((doc as unknown as Record<string, unknown>).name).toBe('Новое имя');
  });

  it('update with a real INN clears the stub flag', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.update(
      new Types.ObjectId().toString(),
      { inn: '7809876543' } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    expect(doc.innIsStub).toBe(false);
  });

  it('remove soft-deletes by writing deletedAt', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.remove(new Types.ObjectId().toString(), {
      organizationId: ownOrgId,
      role: 'manager',
    });

    const [filter, update] = model.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter._id).toBe(doc._id);
    expect(update.$set.deletedAt).toBeInstanceOf(Date);
  });

  it('create accepts optional email (TZ-MIG-304)', async () => {
    const model = makeModel(null);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.create(
      {
        name: 'ООО Ромашка',
        roles: ['customer'],
        inn: '7701234567',
        email: 'info@example.ru',
      } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    const payload = model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.email).toBe('info@example.ru');
  });

  it('update persists email (TZ-MIG-304)', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel(doc);
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await service.update(
      new Types.ObjectId().toString(),
      { email: 'sales@firm.ru' } as any,
      { organizationId: ownOrgId, role: 'manager' },
    );

    expect((doc as unknown as Record<string, unknown>).email).toBe('sales@firm.ru');
  });

  it('remove refuses another tenant counterparty', async () => {
    const model = makeModel(makeDoc(otherOrgId));
    const service = new CounterpartyService(model as any, { create: jest.fn() } as any);

    await expect(
      service.remove(new Types.ObjectId().toString(), {
        organizationId: ownOrgId,
        role: 'manager',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
