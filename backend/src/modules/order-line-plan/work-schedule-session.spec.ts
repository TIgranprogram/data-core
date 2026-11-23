/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { WorkScheduleService } from './work-schedule.service';

/** Запрещаем precommit read вне session детерминированно, без ожидания очереди DDL в Mongo. */
function setup() {
  const planId = new Types.ObjectId(), lineId = new Types.ObjectId(), orderId = new Types.ObjectId(), stepId = new Types.ObjectId(), typeId = new Types.ObjectId(), personId = new Types.ObjectId(), productId = new Types.ObjectId();
  const plan: any = { _id: planId, incomeId: lineId, rev: 1, deletedAt: null, steps: [{ _id: stepId, workTypeId: typeId, hours: 4 }] };
  const line = { _id: lineId, orderId, productId, qty: 1, title: 'Изделие', deletedAt: null };
  const rows: Record<string, any[]> = { orderlineplans: [plan], incomes: [line], salesorders: [{ _id: orderId, deletedAt: null }], worktypes: [{ _id: typeId, name: 'Сварка', deletedAt: null }], persons: [{ _id: personId, workTypeIds: [typeId], status: 'active' }], worktasks: [], designtasks: [], products: [{ _id: productId, name: 'Изделие' }] };
  let active = false;
  let pendingSessionReads = 0;
  const session = { withTransaction: async (run: () => Promise<void>) => { active = true; try { await run(); } finally { active = false; } }, endSession: async () => undefined };
  const check = (name: string, options?: any) => { if (active && options?.session !== session) throw new Error(`OUTSIDE_SESSION:${name}`); };
  const reads: Array<{ name: string; active: boolean; session: unknown }> = [];
  const db = { collection: (name: string) => ({
    findOne: async (_filter: any, options?: any) => { check(name, options); reads.push({ name, active, session: options?.session }); return rows[name]?.[0] ?? null; },
    find: (_filter: any, options?: any) => {
      check(name, options); reads.push({ name, active, session: options?.session });
      const cursor = { sort: () => cursor, toArray: async () => {
        if (!active) return rows[name] ?? [];
        if (pendingSessionReads) throw new Error('PARALLEL_SESSION_READ');
        pendingSessionReads++;
        try { await Promise.resolve(); return rows[name] ?? []; } finally { pendingSessionReads--; }
      } };
      return cursor;
    },
    updateOne: async (filter: any, update: any, options?: any) => {
      check(name, options);
      if (name === 'orderlineplans') {
        if (filter.rev !== undefined && filter.rev !== plan.rev) return { matchedCount: 0 };
        for (const [key, value] of Object.entries(update.$set ?? {})) { if (key.startsWith('steps.0.')) plan.steps[0][key.slice(8)] = value; else plan[key] = value; }
        if (update.$inc?.rev) plan.rev += update.$inc.rev;
      }
      return { matchedCount: 1 };
    },
  }) };
  const cache = new Map<string, unknown>();
  const versions = { cached: jest.fn(async (namespace: string, _colls: unknown, key: string, load: () => Promise<any[]>) => { if (active) throw new Error('GLOBAL_CACHE_IN_TRANSACTION'); const token = namespace + key; if (!cache.has(token)) cache.set(token, (await load()).map((r) => ({ ...r }))); return cache.get(token); }) };
  const svc = new WorkScheduleService({ db, startSession: async () => session } as never, {} as never, versions as never);
  return { svc, plan, planId, stepId, personId, typeId, session, reads, versions, rows };
}

describe('Гант — session источников при переносе шага', () => {
  it('первый и второй перенос используют точную session, stale rev409 сохраняет новую полосу', async () => {
    const t = setup();
    const first = await t.svc.patchStep(String(t.planId), String(t.stepId), { rev: 1, start: '2026-11-23', end: '2026-11-23' });
    expect(first.bar).toMatchObject({ rev: 2, start: '2026-11-23' });
    const second = await t.svc.patchStep(String(t.planId), String(t.stepId), { rev: 2, start: '2026-11-24' });
    expect(second.bar).toMatchObject({ rev: 3, start: '2026-11-24' });
    await expect(t.svc.patchStep(String(t.planId), String(t.stepId), { rev: 2, start: '2026-11-25' })).rejects.toMatchObject({ status: 409 });
    expect(t.plan.rev).toBe(3);
    expect(t.plan.steps[0].plan.start).toEqual(new Date('2026-11-24T00:00:00.000Z'));
    expect(t.reads.filter((r) => r.active).every((r) => r.session === t.session)).toBe(true);
    expect(t.versions.cached).toHaveBeenCalled(); // postcommit-проекция сохраняет обычный кэш.
  });
  it('назначение сотрудника также проверяется в session после claim договора', async () => {
    const t = setup();
    const result = await t.svc.patchStep(String(t.planId), String(t.stepId), { assigneeId: String(t.personId) });
    expect(result.bar.assigneeId).toBe(String(t.personId));
    expect(t.reads).toContainEqual({ name: 'persons', active: true, session: t.session });
  });
  it('тёплый глобальный кэш не заменяет session-read; несовместимый сотрудник400 не меняет шаг', async () => {
    const t = setup();
    await (t.svc as any).workTypes(); // намеренно прогрет глобальный кэш.
    t.rows.persons[0].workTypeIds = [];
    await expect(t.svc.patchStep(String(t.planId), String(t.stepId), { assigneeId: String(t.personId) })).rejects.toMatchObject({ status: 400 });
    expect(t.reads).toContainEqual({ name: 'worktypes', active: true, session: t.session });
    expect(t.versions.cached).toHaveBeenCalledTimes(1); // только прогрев вне транзакции.
    expect(t.plan).toMatchObject({ rev: 1, steps: [{ hours: 4 }] });
    expect(t.plan.steps[0]).not.toHaveProperty('assigneeId');
  });
});
