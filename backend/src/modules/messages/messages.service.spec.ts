import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MessagesService } from './messages.service';

const A = new Types.ObjectId(), B = new Types.ObjectId(), C = new Types.ObjectId();
const me = { id: String(A), username: 'a', role: 'user' };

function make(opts: { target?: unknown } = {}) {
  const created: Record<string, unknown>[] = [];
  const queries: unknown[] = [];
  const model = {
    create: jest.fn(async (d: Record<string, unknown>) => { created.push(d); return { toObject: () => ({ _id: new Types.ObjectId(), createdAt: new Date(), ...d }) }; }),
    updateMany: jest.fn((f: unknown) => { queries.push(f); return { exec: async () => ({ modifiedCount: 2 }) }; }),
    find: jest.fn((f: unknown) => { queries.push(f); const c: Record<string, unknown> = {}; for (const k of ['sort', 'skip', 'limit', 'lean']) c[k] = () => c; c.exec = async () => []; return c; }),
    countDocuments: jest.fn(() => ({ exec: async () => 0 })),
  };
  const usersColl = { findOne: jest.fn(async () => opts.target ?? null) };
  const connection = { db: { collection: () => usersColl } };
  const notices = { notify: jest.fn(async () => ({})) };
  const svc = new MessagesService(connection as never, model as never, notices as never);
  return { svc, model, notices, created, queries, usersColl };
}

describe('MessagesService', () => {
  it('писать самому себе нельзя', async () => {
    const { svc } = make({ target: { _id: A } });
    await expect(svc.send({ toUserId: String(A), text: 'привет' }, me)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('пустой текст и несуществующий/отключённый получатель — ошибка', async () => {
    const { svc } = make();
    await expect(svc.send({ toUserId: String(B), text: '   ' }, me)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.send({ toUserId: String(B), text: 'привет' }, me)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('отправка создаёт сообщение и важное уведомление получателю', async () => {
    const { svc, notices, created } = make({ target: { _id: B, displayName: 'Борис' } });
    const r = await svc.send({ toUserId: String(B), text: 'привет' }, me);
    expect(created[0]).toMatchObject({ text: 'привет' });
    expect(r.mine).toBe(true);
    expect(notices.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: B, type: 'message', kind: 'important' }));
  });
  it('переписка и прочтение ограничены участниками (я + собеседник)', async () => {
    const { svc, queries } = make();
    await svc.with(String(B), {}, me);
    const f = queries[0] as { $or: Array<{ fromUserId: Types.ObjectId; toUserId: Types.ObjectId }> };
    expect(f.$or.every((x) => [x.fromUserId, x.toUserId].some((i) => String(i) === String(A)))).toBe(true);
    expect(JSON.stringify(f)).not.toContain(String(C));
    await svc.markRead(String(B), me);
    expect(queries[1]).toMatchObject({ toUserId: A, fromUserId: B, readAt: null });
  });
  it('некорректный id собеседника — 400', async () => {
    const { svc } = make();
    await expect(svc.with('zzz', {}, me)).rejects.toBeInstanceOf(BadRequestException);
  });
});
