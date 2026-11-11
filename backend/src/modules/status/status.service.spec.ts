import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StatusService } from './status.service';

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

function make(opts: {
  statuses?: unknown[];
  workflows?: Array<Record<string, unknown>>;
  updated?: unknown | null;
} = {}) {
  const statusModel = {
    find: jest.fn(() => chain(opts.statuses ?? [])),
    create: jest.fn(async (d: Record<string, unknown>) => ({ ...d, _id: 's1' })),
    findOneAndUpdate: jest.fn(() => chain(opts.updated === undefined ? { statusId: 'open' } : opts.updated)),
  };
  const workflowModel = {
    find: jest.fn(() => chain(opts.workflows ?? [])),
    create: jest.fn(async (d: Record<string, unknown>) => ({ ...d, _id: 'w1' })),
  };
  const service = new StatusService(statusModel as never, workflowModel as never);
  return { service, statusModel, workflowModel };
}

describe('StatusService', () => {
  it('findStatuses сортирует по entityType', async () => {
    const rows = [{ statusId: 'a' }, { statusId: 'b' }];
    const { service, statusModel } = make({ statuses: rows });
    await expect(service.findStatuses('order')).resolves.toEqual(rows);
    expect(statusModel.find).toHaveBeenCalledWith({ entityType: 'order' });
  });

  it('createStatus пишет документ', async () => {
    const { service, statusModel } = make();
    const data = { entityType: 'order', statusId: 'new', label: 'Новый' };
    await expect(service.createStatus(data)).resolves.toMatchObject(data);
    expect(statusModel.create).toHaveBeenCalledWith(data);
  });

  it('updateStatus: нет записи → 404', async () => {
    const { service } = make({ updated: null });
    await expect(service.updateStatus('order', 'gone', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertTransition: тот же статус → 400', async () => {
    const { service, workflowModel } = make();
    await expect(service.assertTransition('order', 'new', 'new', 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(workflowModel.find).not.toHaveBeenCalled();
  });

  it('assertTransition: нет активного workflow → 400', async () => {
    const { service } = make({ workflows: [] });
    await expect(service.assertTransition('order', 'new', 'done', 'admin')).rejects.toThrow(/No active workflow/);
  });

  it('assertTransition: переход разрешён роли', async () => {
    const t = { fromStatus: 'new', toStatus: 'done', roles: ['manager'] };
    const { service } = make({
      workflows: [{ entityType: 'order', isActive: true, transitions: [t] }],
    });
    await expect(service.assertTransition('order', 'new', 'done', 'manager')).resolves.toEqual(t);
  });

  it('assertTransition: роль не в списке → 400', async () => {
    const { service } = make({
      workflows: [{
        entityType: 'order',
        isActive: true,
        transitions: [{ fromStatus: 'new', toStatus: 'done', roles: ['admin'] }],
      }],
    });
    await expect(service.assertTransition('order', 'new', 'done', 'viewer')).rejects.toThrow(/not allowed/);
  });
});
