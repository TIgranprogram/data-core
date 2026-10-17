import { BadRequestException } from '@nestjs/common';
import { ImportTaskService } from './import-task.service';

function buildService(opts: {
  create?: jest.Mock;
  findByIdDoc?: any;
  aggregate?: jest.Mock;
  countDocuments?: jest.Mock;
} = {}) {
  const create = opts.create ?? jest.fn();
  const findById = jest.fn().mockImplementation(() => ({
    exec: jest.fn().mockResolvedValue(opts.findByIdDoc ?? null),
  }));
  const aggregate =
    opts.aggregate ?? jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
  const countDocuments =
    opts.countDocuments ?? jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

  const model = {
    create,
    findById,
    aggregate,
    countDocuments,
  } as any;

  const service = new ImportTaskService(model);
  return { service, create, findById, model };
}

const user = {
  id: '507f1f77bcf86cd799439011',
  username: 'mgr',
  role: 'manager',
  organizationId: '507f1f77bcf86cd799439022',
};

const threeRows = [
  { rowIndex: 0, raw: { name: 'A' }, name: 'A', unit: 'шт' },
  { rowIndex: 1, raw: { name: 'B' }, name: 'B' },
  { rowIndex: 2, raw: { name: 'C' }, name: 'C', article: 'X1' },
];

describe('ImportTaskService (TZD-22)', () => {
  it('create with 3 rows → ready_for_ai, proposalIds=[], aiReport=null', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        createdByUserId: user.id,
        organizationId: user.organizationId,
        source: { fileName: 't.xlsx', fileType: 'xlsx' },
        status: 'ready_for_ai',
        rows: threeRows,
        summary: 't.xlsx · 3 строк',
        aiReport: null,
        proposalIds: [],
        toObject() {
          return this;
        },
      }),
    });

    const view = await service.create(
      {
        source: { fileName: 't.xlsx', fileType: 'xlsx' },
        rows: threeRows,
      },
      user,
    );

    expect(view.status).toBe('ready_for_ai');
    expect(view.rowCount).toBe(3);
    expect(view.proposalIds).toEqual([]);
    expect(view.aiReport).toBeNull();
    expect(create).toHaveBeenCalled();
    const arg = create.mock.calls[0][0];
    expect(arg.status).toBe('ready_for_ai');
    expect(arg.proposalIds).toEqual([]);
    expect(arg.aiReport).toBeNull();
  });

  it('create accepts 600 rows (TZD-18 cap ≥600)', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      rowIndex: i,
      raw: { name: `R${i}` },
      name: `R${i}`,
    }));
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        createdByUserId: user.id,
        organizationId: user.organizationId,
        source: { fileName: 'big.csv', fileType: 'csv' },
        status: 'ready_for_ai',
        rows,
        summary: 'big.csv · 600 строк',
        aiReport: null,
        proposalIds: [],
        toObject() {
          return this;
        },
      }),
    });
    const view = await service.create(
      { source: { fileName: 'big.csv', fileType: 'csv' }, rows },
      user,
    );
    expect(view.rowCount).toBe(600);
    expect(create).toHaveBeenCalled();
  });

  it('create rejects >2000 rows (TZD-18)', async () => {
    const { service } = buildService();
    const rows = Array.from({ length: 2001 }, (_, i) => ({
      rowIndex: i,
      raw: { name: `R${i}` },
      name: `R${i}`,
    }));
    await expect(
      service.create(
        { source: { fileName: 'big.csv', fileType: 'csv' }, rows },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list returns summary/rowCount without requiring full rows in items', async () => {
    const { service } = buildService({
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            _id: '507f1f77bcf86cd799439033',
            source: { fileName: 't.xlsx', fileType: 'xlsx' },
            status: 'ready_for_ai',
            summary: 't.xlsx · 3 строк',
            rowCount: 3,
            createdAt: new Date('2026-08-08T00:00:00Z'),
          },
        ]),
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      }),
    });

    const result = await service.list(user, { limit: 10 });
    expect(result.total).toBe(1);
    expect(result.items[0].rowCount).toBe(3);
    expect(result.items[0].summary).toContain('t.xlsx');
    expect((result.items[0] as any).rows).toBeUndefined();
  });

  it('patchStatus ready_for_ai → cancelled and reopen', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'ready_for_ai',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: null,
      save,
      toObject() {
        return { ...this, _id: this._id };
      },
    };
    const { service } = buildService({ findByIdDoc: doc });

    const cancelled = await service.patchStatus(
      '507f1f77bcf86cd799439033',
      { status: 'cancelled' },
      user,
    );
    expect(cancelled.status).toBe('cancelled');
    expect(save).toHaveBeenCalled();

    doc.status = 'cancelled';
    const reopened = await service.patchStatus(
      '507f1f77bcf86cd799439033',
      { status: 'ready_for_ai' },
      user,
    );
    expect(reopened.status).toBe('ready_for_ai');
  });

  it('patchStatus rejects done → analyzing', async () => {
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'done',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: [],
      proposalIds: [],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service } = buildService({ findByIdDoc: doc });
    await expect(
      service.patchStatus(
        '507f1f77bcf86cd799439033',
        { status: 'analyzing' },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('patchReport persists aiReport + awaiting_user, rows intact (TZD-23)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'analyzing',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: null,
      save,
      toObject() {
        return { ...this, _id: this._id };
      },
    };
    const { service } = buildService({ findByIdDoc: doc });

    const view = await service.patchReport(
      '507f1f77bcf86cd799439033',
      {
        status: 'awaiting_user',
        summary: 't.xlsx · 2 new / 1 skip / 1 update / 1 doubt',
        aiReport: {
          version: 1,
          counts: { new: 2, skip: 1, update: 1, doubt: 1 },
          rows: [
            { rowIndex: 0, decision: 'new', proposed: { name: 'A' } },
            { rowIndex: 1, decision: 'skip', reason: 'dup' },
            {
              rowIndex: 2,
              decision: 'update',
              materialId: '507f1f77bcf86cd799439044',
              proposed: { unit: 'м' },
            },
            { rowIndex: 3, decision: 'doubt', reason: 'ambiguous' },
          ],
        },
      },
      user,
    );

    expect(view.status).toBe('awaiting_user');
    expect(view.aiReport.counts.new).toBe(2);
    expect(view.aiReport.rows).toHaveLength(4);
    expect(view.rowCount).toBe(3);
    expect(view.rows).toHaveLength(3); // rows/source intact
    expect(doc.aiReport.version).toBe(1);
    expect(doc.aiReport.matchedAt).toBeDefined();
    expect(doc.proposalIds).toEqual([]);
  });

  it('patchReport fills default counts when omitted (TZD-23)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'ready_for_ai',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: null,
      save,
      toObject() {
        return this;
      },
    };
    const { service } = buildService({ findByIdDoc: doc });
    await service.patchReport(
      '507f1f77bcf86cd799439033',
      { status: 'analyzing', aiReport: { rows: [] } },
      user,
    );
    expect(doc.status).toBe('analyzing');
    expect(doc.aiReport.counts).toEqual({ new: 0, skip: 0, update: 0, doubt: 0 });
  });

  it('patchProposals links ids + applying; rejects bad ObjectId (TZD-23)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'awaiting_user',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: null,
      save,
      toObject() {
        return { ...this, _id: this._id };
      },
    };
    const { service } = buildService({ findByIdDoc: doc });

    const ids = [
      '507f1f77bcf86cd799439101',
      '507f1f77bcf86cd799439102',
      '507f1f77bcf86cd799439103',
    ];
    const view = await service.patchProposals(
      '507f1f77bcf86cd799439033',
      { proposalIds: ids, status: 'applying' },
      user,
    );
    expect(view.status).toBe('applying');
    expect(view.proposalIds).toEqual(ids);

    await expect(
      service.patchProposals(
        '507f1f77bcf86cd799439033',
        { proposalIds: ['not-an-id'] },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('patchReport rejects transition from terminal done (TZD-23)', async () => {
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'done',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: [],
      proposalIds: [],
      aiReport: null,
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service } = buildService({ findByIdDoc: doc });
    await expect(
      service.patchReport(
        '507f1f77bcf86cd799439033',
        { status: 'awaiting_user', aiReport: { rows: [] } },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('patchRows replaces rows + columnMap/reshapeNote and resets aiReport (TZD-26)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'awaiting_user',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: { version: 1, counts: { new: 3, skip: 0, update: 0, doubt: 0 }, rows: [] },
      save,
      toObject() {
        return { ...this, _id: this._id };
      },
    };
    const { service } = buildService({ findByIdDoc: doc });

    const newRows = [
      { rowIndex: 0, raw: { name: 'X' }, name: 'X', unit: 'м' },
      { rowIndex: 1, raw: { name: 'Y' }, name: 'Y' },
    ];
    const view = await service.patchRows(
      '507f1f77bcf86cd799439033',
      {
        rows: newRows,
        columnMap: { 'Наименование': 'name', 'Ед. изм.': 'unit', 'Цена': null },
        reshapeNote: '«Наименование» → name; «Цена» удалена (не материал)',
      },
      user,
    );

    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].name).toBe('X');
    expect(view.columnMap).toEqual({
      'Наименование': 'name',
      'Ед. изм.': 'unit',
      'Цена': null,
    });
    expect(view.reshapeNote).toContain('«Цена» удалена');
    expect(view.aiReport).toBeNull(); // stale plan reset — re-match required
  });

  it('patchRows rejects reshape after applying/done (TZD-26)', async () => {
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      status: 'applying',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      source: { fileName: 't.xlsx', fileType: 'xlsx' },
      rows: threeRows,
      proposalIds: [],
      aiReport: null,
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service } = buildService({ findByIdDoc: doc });
    await expect(
      service.patchRows(
        '507f1f77bcf86cd799439033',
        { rows: [{ rowIndex: 0, raw: { name: 'Z' }, name: 'Z' }] },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create does not depend on Material / journal (model.create only)', async () => {
    const { service, create, model } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        status: 'ready_for_ai',
        rows: threeRows,
        source: { fileName: 't.xlsx', fileType: 'xlsx' },
        proposalIds: [],
        aiReport: null,
        toObject() {
          return this;
        },
      }),
    });
    await service.create(
      { source: { fileName: 't.xlsx', fileType: 'xlsx' }, rows: threeRows },
      user,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(model.findById).not.toHaveBeenCalled();
  });
});
