import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';

describe('NotificationsService.safe / toRoles', () => {
  const a = new Types.ObjectId(), b = new Types.ObjectId();
  const mk = (users: unknown[], fail = false) => {
    const created: Array<Record<string, unknown>> = [];
    const model = { create: async (d: Record<string, unknown>) => { if (fail) throw new Error('boom'); created.push(d); return { toObject: () => d }; } };
    const conn = { db: { collection: () => ({ find: () => ({ toArray: async () => users }) }) } };
    return { svc: new NotificationsService(model as never, conn as never), created };
  };

  it('себе не шлёт', async () => {
    const { svc, created } = mk([]);
    expect(await svc.safe({ userId: a, type: 'x', text: 't' }, String(a))).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('другому шлёт с автором', async () => {
    const { svc, created } = mk([]);
    expect(await svc.safe({ userId: b, type: 'x', text: 't' }, String(a))).toBe(true);
    expect(String(created[0].fromUserId)).toBe(String(a));
  });

  it('ошибка записи не пробрасывается', async () => {
    const { svc } = mk([], true);
    await expect(svc.safe({ userId: b, type: 'x', text: 't' })).resolves.toBe(false);
  });

  it('ролям: всем, кроме исполнителя', async () => {
    const { svc, created } = mk([{ _id: a }, { _id: b }]);
    expect(await svc.toRoles(['accountant'], { type: 'invoice_awaiting_payment', text: 't' }, String(a))).toBe(1);
    expect(String(created[0].userId)).toBe(String(b));
  });
});
