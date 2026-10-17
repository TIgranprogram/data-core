import { BadRequestException } from '@nestjs/common';
import { ImportTodoService } from './import-todo.service';

function buildService(opts: {
  create?: jest.Mock;
  findByIdDoc?: any;
  find?: jest.Mock;
  countDocuments?: jest.Mock;
} = {}) {
  const create = opts.create ?? jest.fn();
  const findById = jest.fn().mockImplementation(() => ({
    exec: jest.fn().mockResolvedValue(opts.findByIdDoc ?? null),
  }));
  const find = opts.find ?? jest.fn().mockResolvedValue([]);
  const countDocuments =
    opts.countDocuments ?? jest.fn().mockResolvedValue(0);

  const model = {
    create,
    findById,
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: find,
    }),
    countDocuments: jest.fn(() => ({ exec: countDocuments })),
  } as any;

  const service = new ImportTodoService(model);
  return { service, create, findById, model, countDocuments };
}

const user = {
  id: '507f1f77bcf86cd799439011',
  username: 'mgr',
  role: 'manager',
  organizationId: '507f1f77bcf86cd799439022',
};

describe('ImportTodoService (TZD-29)', () => {
  it('create → status open + org scoped', async () => {
    const { service, create } = buildService({
      create: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        title: 'Проверить сомнительные строки',
        status: 'open',
        organizationId: user.organizationId,
        createdByUserId: user.id,
        toObject() {
          return this;
        },
      }),
    });

    const view = await service.create(
      { title: 'Проверить сомнительные строки', body: '3 doubt-строки' },
      user,
    );
    expect(view.status).toBe('open');
    expect(view.title).toContain('Проверить');
    const arg = create.mock.calls[0][0];
    expect(arg.organizationId).toBeDefined();
    expect(arg.status).toBe('open');
  });

  it('list with status=open filter → items + total', async () => {
    const { service } = buildService({
      find: jest.fn().mockResolvedValue([
        {
          _id: '507f1f77bcf86cd799439033',
          title: 'Доделать шаблон Акт',
          href: '/doc-constructor/templates/x',
          status: 'open',
          createdAt: new Date('2026-08-08T00:00:00Z'),
        },
      ]),
      countDocuments: jest.fn().mockResolvedValue(1),
    });

    const result = await service.list(user, { status: 'open' });
    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe('open');
    expect(result.items[0].href).toContain('/doc-constructor');
  });

  it('patchStatus open → done; rejects bad id', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: '507f1f77bcf86cd799439033',
      title: 'X',
      status: 'open',
      createdByUserId: { toString: () => user.id },
      organizationId: { toString: () => user.organizationId },
      save,
      toObject() {
        return { ...this, _id: this._id };
      },
    };
    const { service } = buildService({ findByIdDoc: doc });

    const view = await service.patchStatus(
      '507f1f77bcf86cd799439033',
      { status: 'done' },
      user,
    );
    expect(view.status).toBe('done');
    expect(save).toHaveBeenCalled();

    await expect(
      service.patchStatus('not-an-id', { status: 'done' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
