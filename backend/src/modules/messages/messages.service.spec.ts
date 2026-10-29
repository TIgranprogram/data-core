import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MessagesService } from './messages.service';

const A = new Types.ObjectId(), B = new Types.ObjectId(), C = new Types.ObjectId();
const me = { id: String(A), username: 'a', role: 'user' };

function make(opts: { target?: unknown; readAt?: Date | null; userCreatedAt?: Date; photosFound?: number; unread?: number } = {}) {
  const created: Record<string, unknown>[] = [];
  const queries: unknown[] = [];
  const model = {
    create: jest.fn(async (d: Record<string, unknown>) => { created.push(d); return { toObject: () => ({ _id: new Types.ObjectId(), createdAt: new Date(), ...d }) }; }),
    updateMany: jest.fn((f: unknown) => { queries.push(f); return { exec: async () => ({ modifiedCount: 2 }) }; }),
    find: jest.fn((f: unknown) => { queries.push(f); const c: Record<string, unknown> = {}; for (const k of ['sort', 'skip', 'limit', 'lean']) c[k] = () => c; c.exec = async () => []; return c; }),
    findOne: jest.fn((f: unknown) => { queries.push(f); const c: Record<string, unknown> = {}; for (const k of ['sort', 'lean']) c[k] = () => c; c.exec = async () => null; return c; }),
    aggregate: jest.fn(() => ({ exec: async () => [] })),
    countDocuments: jest.fn((f: unknown) => { if ('createdAt' in (f as object)) queries.push(f); return { exec: async () => opts.unread ?? 0 }; }),
  };
  const reads = {
    findOne: jest.fn(() => ({ lean: () => ({ exec: async () => (opts.readAt ? { readAt: opts.readAt } : null) }) })),
    updateOne: jest.fn(() => ({ exec: async () => ({}) })),
  };
  const usersColl = {
    findOne: jest.fn(async (f: Record<string, unknown>) => (opts.userCreatedAt && !('isActive' in f) ? { createdAt: opts.userCreatedAt } : opts.target ?? null)),
    find: jest.fn(() => ({ toArray: async () => [] })),
  };
  const photosColl = {
    countDocuments: jest.fn(async () => opts.photosFound ?? 0),
    find: jest.fn(() => ({ toArray: async () => [] })),
  };
  const connection = { db: { collection: (n: string) => (n === 'photos' ? photosColl : usersColl) } };
  const notices = { notify: jest.fn(async () => ({})) };
  const svc = new MessagesService(connection as never, model as never, reads as never, notices as never);
  return { svc, model, reads, notices, created, queries, usersColl };
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

  it('пусто и без фото — 400; фото без текста — можно', async () => {
    const { svc, created } = make({ target: { _id: B }, photosFound: 1 });
    await expect(svc.send({ toUserId: String(B), text: ' ', photoIds: [] }, me)).rejects.toThrow('Напишите текст или добавьте фото');
    const ph = String(new Types.ObjectId());
    const r = await svc.send({ toUserId: String(B), photoIds: [ph] }, me);
    expect(created[0]).toMatchObject({ text: '' });
    expect(String((created[0].photoIds as unknown[])[0])).toBe(ph);
    expect(r.photos).toEqual([]);
  });
  it('несуществующее фото — 400', async () => {
    const { svc } = make({ target: { _id: B }, photosFound: 0 });
    await expect(svc.send({ toUserId: String(B), photoIds: [String(new Types.ObjectId())] }, me)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('«Всем»: без получателя, без уведомлений, подпись отправителя', async () => {
    const { svc, notices, created } = make({ target: { _id: A, displayName: 'Анна' } });
    const r = await svc.send({ toAll: true, text: 'всем привет' }, me);
    expect(created[0]).toMatchObject({ toAll: true, text: 'всем привет' });
    expect(created[0]).not.toHaveProperty('toUserId');
    expect(notices.notify).not.toHaveBeenCalled();
    expect(r).toMatchObject({ toAll: true, toUserId: null, mine: true, fromName: 'Анна' });
  });
  it('без toAll и без получателя — 400', async () => {
    const { svc } = make();
    await expect(svc.send({ text: 'привет' }, me)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('лента «Всем» берёт только toAll; отметка прочтения — upsert', async () => {
    const { svc, queries, reads } = make();
    await svc.feed({}, me);
    expect(queries[0]).toEqual({ toAll: true });
    await svc.markAllRead(me);
    expect(reads.updateOne).toHaveBeenCalledWith({ userId: A, channel: 'all' }, expect.anything(), { upsert: true });
  });
  it('непрочитанные «Всем»: чужие позже readAt; нет записи — позже createdAt сотрудника; входят в общий unread', async () => {
    const readAt = new Date('2026-01-02');
    const a = make({ readAt, unread: 3 });
    const t = await a.svc.threads(me);
    const f = a.queries.find((q) => (q as { toAll?: boolean }).toAll === true && 'createdAt' in (q as object)) as { fromUserId: unknown; createdAt: { $gt: Date } };
    expect(f.createdAt.$gt).toEqual(readAt);
    expect(String((f.fromUserId as { $ne: unknown }).$ne)).toBe(String(A));
    expect(t.all.unread).toBe(3);
    expect(t.unread).toBe(3);
    const created = new Date('2026-03-04');
    const b = make({ userCreatedAt: created });
    await b.svc.threads(me);
    const g = b.queries.find((q) => (q as { toAll?: boolean }).toAll === true && 'createdAt' in (q as object)) as { createdAt: { $gt: Date } };
    expect(g.createdAt.$gt).toEqual(created);
  });
});
