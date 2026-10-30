import { emptyMetrics, type Metrics } from './control.rollup';
import { ControlService, COL_DAILY, COL_MONTHLY, COL_RUNS } from './control.service';
import { collectNow } from './control.collect';
import { LatencyHistogram, latency } from '../../common/interceptors/latency-histogram';
import type { CreateRunDto } from './dto/control.dto';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Мини-коллекция в памяти: только то, что нужно сервису (поиск по _id/receivedAt, upsert, удаление). */
function fakeCollection() {
  const rows = new Map<string, Doc>();
  const test = (v: unknown, cond: unknown): boolean => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      const x = v instanceof Date ? v.getTime() : v;
      const n = (z: unknown) => (z instanceof Date ? z.getTime() : z) as number | string;
      return (c.$gte === undefined || x! >= n(c.$gte)) && (c.$lte === undefined || x! <= n(c.$lte)) && (c.$lt === undefined || x! < n(c.$lt));
    }
    return v === cond;
  };
  const match = (d: Doc, f: Doc) => Object.entries(f).every(([k, c]) => test(d[k], c));
  const cursor = (list: Doc[]) => {
    let out = list;
    const c = {
      sort: (s: Doc) => { const [k, dir] = Object.entries(s)[0]; out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir as number)); return c; },
      skip: (n: number) => { out = out.slice(n); return c; },
      limit: (n: number) => { out = out.slice(0, n); return c; },
      toArray: async () => out.map((d) => structuredClone(d)),
    };
    return c;
  };
  return {
    rows,
    createIndex: jest.fn(async () => 'ok'),
    findOne: async (f: Doc) => { const d = [...rows.values()].find((r) => match(r, f)); return d ? structuredClone(d) : null; },
    find: (f: Doc = {}) => cursor([...rows.values()].filter((r) => match(r, f))),
    countDocuments: async (f: Doc = {}) => [...rows.values()].filter((r) => match(r, f)).length,
    updateOne: async (f: Doc, u: Doc, o: Doc = {}) => {
      const found = [...rows.values()].find((r) => match(r, f));
      if (!found && !o.upsert) return { upsertedCount: 0 };
      const row: Doc = found ?? { _id: f._id, ...(u.$setOnInsert ?? {}) };
      const upserted = found ? 0 : 1;
      Object.assign(row, structuredClone(u.$set ?? {}));
      rows.set(row._id, row);
      return { upsertedCount: upserted };
    },
    deleteMany: async (f: Doc) => { let n = 0; for (const [k, r] of rows) if (match(r, f)) { rows.delete(k); n++; } return { deletedCount: n }; },
  };
}

function makeService(extra: Record<string, ReturnType<typeof fakeCollection>> = {}) {
  const cols: Record<string, ReturnType<typeof fakeCollection>> = {
    [COL_RUNS]: fakeCollection(), [COL_DAILY]: fakeCollection(), [COL_MONTHLY]: fakeCollection(), disk_usage_history: fakeCollection(), ...extra,
  };
  const connection = { db: { collection: (n: string) => cols[n] ?? (cols[n] = fakeCollection()) } };
  const svc = new ControlService(connection as never);
  return { svc, cols };
}

const at = (iso: string) => new Date(iso);
const collectStub = (m: Metrics) => async () => ({ ...emptyMetrics(), ...m });

describe('CC-12: снимок дня', () => {
  it('пишет все ключи каталога: известные числом, неизвестные null (не 0)', async () => {
    const { svc, cols } = makeService();
    const r = await svc.snapshotDay(at('2026-10-31T20:30:00'), { collect: collectStub({ 'errors.total': 3, 'speed.slow_count': 0 }) });
    expect(r).toEqual({ date: '2026-10-31', created: true });
    const d = cols[COL_DAILY].rows.get('2026-10-31')!;
    expect(d.m['errors.total']).toBe(3);
    expect(d.m['speed.slow_count']).toBe(0);
    expect(d.m['data.dup_partners']).toBeNull();
    expect(d.schemaV).toBe(1);
    expect(d.meta.source).toBe('snapshot');
  });

  it('повторный снимок за то же число ничего не меняет и не сбрасывает счётчик задержек', async () => {
    const { svc, cols } = makeService();
    await svc.snapshotDay(at('2026-10-31T20:30:00'), { collect: collectStub({ 'errors.total': 3 }) });
    latency.observe(10);
    const before = latency.snapshot().requests;
    const r = await svc.snapshotDay(at('2026-10-31T20:40:00'), { collect: collectStub({ 'errors.total': 99 }) });
    expect(r.created).toBe(false);
    expect(cols[COL_DAILY].rows.get('2026-10-31')!.m['errors.total']).toBe(3);
    expect(latency.snapshot().requests).toBe(before);
    expect(cols[COL_DAILY].rows.size).toBe(1);
  });

  it('force пересчитывает, но null не затирает записанное', async () => {
    const { svc, cols } = makeService();
    await svc.snapshotDay(at('2026-10-31T20:30:00'), { collect: collectStub({ 'errors.total': 3 }) });
    await svc.snapshotDay(at('2026-10-31T20:40:00'), { force: true, collect: collectStub({ 'errors.unhandled': 1 }) });
    const m = cols[COL_DAILY].rows.get('2026-10-31')!.m;
    expect(m['errors.total']).toBe(3);
    expect(m['errors.unhandled']).toBe(1);
  });

  it('прогон с ПК попадает в «Проверки кода»', async () => {
    const { svc, cols } = makeService();
    const now = at('2026-10-31T20:30:00');
    await svc.ingestRun(runDto({ red: 1, green: 1, total: 2, durationMs: 60_000, steps: [{ step: 'e2e', code: 1, ms: 5, ok: false }] }), at('2026-10-31T01:00:00'));
    await svc.snapshotDay(now, { collect: collectStub({}) });
    const m = cols[COL_DAILY].rows.get('2026-10-31')!.m;
    expect(m['code.steps_red']).toBe(1);
    expect(m['code.e2e_ok']).toBe(0);
    expect(m['code.smoke_ok']).toBeNull();
  });

  it('tick: до 23:30 не снимает, после — один раз', async () => {
    const { svc, cols } = makeService();
    const spy = jest.spyOn(svc, 'snapshotDay').mockImplementation(async (now = new Date()) => { cols[COL_DAILY].rows.set('x', { _id: 'x' }); return { date: String(now), created: true }; });
    await svc.tick(new Date(2026, 9, 31, 23, 29));
    expect(spy).not.toHaveBeenCalled();
    await svc.tick(new Date(2026, 9, 31, 23, 30));
    await svc.tick(new Date(2026, 9, 31, 23, 45));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('CC-12: месячная свёртка и чистка', () => {
  const day = (id: string, v: number) => ({ _id: id, m: { 'errors.total': v }, schemaV: 1 });

  it('rollMonth идемпотентна и не затирает свёртку, если дней стало меньше', async () => {
    const { svc, cols } = makeService();
    for (const [i, v] of [[1, 10], [2, 30]] as const) cols[COL_DAILY].rows.set(`2026-09-0${i}`, day(`2026-09-0${i}`, v));
    expect(await svc.rollMonth('2026-09')).toMatchObject({ days: 2, written: true });
    expect(await svc.rollMonth('2026-09')).toMatchObject({ days: 2, written: true });
    expect(cols[COL_MONTHLY].rows.get('2026-09')!.m['errors.total']).toEqual({ min: 10, max: 30, avg: 20, last: 30, n: 2 });
    cols[COL_DAILY].rows.delete('2026-09-01');
    expect(await svc.rollMonth('2026-09')).toMatchObject({ written: false });
    expect(cols[COL_MONTHLY].rows.get('2026-09')!.days).toBe(2);
  });

  it('cleanup стирает дни старше 400 суток только после свёртки их месяца', async () => {
    const { svc, cols } = makeService();
    const now = at('2026-10-31T20:30:00');
    cols[COL_DAILY].rows.set('2025-05-01', day('2025-05-01', 5)); // старше 400 дней
    cols[COL_DAILY].rows.set('2026-10-30', day('2026-10-30', 7)); // свежий
    const r = await svc.cleanup(now);
    expect(r.removed).toBe(1);
    expect(cols[COL_DAILY].rows.has('2025-05-01')).toBe(false);
    expect(cols[COL_DAILY].rows.has('2026-10-30')).toBe(true);
    expect(cols[COL_MONTHLY].rows.get('2025-05')!.m['errors.total'].last).toBe(5);
  });

  it('cleanup оставляет дни, если свёртка месяца не сошлась', async () => {
    const { svc, cols } = makeService();
    cols[COL_DAILY].rows.set('2025-05-01', day('2025-05-01', 5));
    jest.spyOn(svc, 'rollMonth').mockResolvedValue({ month: '2025-05', days: 0, written: false });
    expect((await svc.cleanup(at('2026-10-31T20:30:00'))).removed).toBe(0);
    expect(cols[COL_DAILY].rows.has('2025-05-01')).toBe(true);
  });

  it('disk_usage_history вливается в daily; повтор ничего не меняет; старая коллекция цела', async () => {
    const { svc, cols } = makeService();
    cols.disk_usage_history.rows.set('2026-10-01', { _id: '2026-10-01', usedBytes: 40, totalBytes: 100 });
    expect(await svc.mergeDiskHistory()).toEqual({ merged: 1 });
    const d = cols[COL_DAILY].rows.get('2026-10-01')!;
    expect(d.m['storage.disk_used_pct']).toBe(40);
    expect(d.m['errors.total']).toBeNull();
    expect(await svc.mergeDiskHistory()).toEqual({ merged: 0 });
    expect(cols.disk_usage_history.rows.size).toBe(1);
    expect(cols[COL_MONTHLY].rows.get('2026-10')!.m['storage.disk_used_bytes'].last).toBe(40);
  });
});

function runDto(over: Partial<CreateRunDto> = {}): CreateRunDto {
  return { date: '2026-10-31T01:00:00.000Z', commit: 'abc1234', total: 1, green: 1, red: 0, failed: [], steps: [{ step: 'tsc', code: 0, ms: 5, ok: true }], ...over } as CreateRunDto;
}

describe('CC-13: приём прогона', () => {
  it('повтор того же прогона заменяет запись; receivedAt остаётся первым', async () => {
    const { svc, cols } = makeService();
    const a = await svc.ingestRun(runDto(), at('2026-10-31T02:00:00Z'));
    const b = await svc.ingestRun(runDto({ green: 1 }), at('2026-11-01T02:00:00Z'));
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect(cols[COL_RUNS].rows.size).toBe(1);
    expect(cols[COL_RUNS].rows.get(a.id)!.receivedAt).toEqual(at('2026-10-31T02:00:00Z'));
    expect(cols[COL_RUNS].rows.get(a.id)!.node).toBe('pc');
  });

  it('keepUntil: 90 дней у зелёного, год у провала', async () => {
    const { svc, cols } = makeService();
    const now = at('2026-10-31T00:00:00Z');
    const g = await svc.ingestRun(runDto({ commit: 'g' }), now);
    const r = await svc.ingestRun(runDto({ commit: 'r', red: 1, failed: ['unit'] }), now);
    expect(cols[COL_RUNS].rows.get(g.id)!.keepUntil.getTime() - now.getTime()).toBe(90 * 86_400_000);
    expect(cols[COL_RUNS].rows.get(r.id)!.keepUntil.getTime() - now.getTime()).toBe(365 * 86_400_000);
  });

  it('неверная дата → 400 по-русски', async () => {
    const { svc } = makeService();
    await expect(svc.ingestRun(runDto({ date: 'вчера' }))).rejects.toThrow('Дата прогона');
  });

  it('индексы: TTL по keepUntil с expireAfterSeconds 0', async () => {
    const { svc, cols } = makeService();
    await svc.ensureIndexes();
    expect(cols[COL_RUNS].createIndex).toHaveBeenCalledWith({ keepUntil: 1 }, { expireAfterSeconds: 0 });
  });
});

describe('списки и каталог', () => {
  it('daily/monthly: {items,total,page,limit}, фильтр по периоду, неверный формат — 400', async () => {
    const { svc, cols } = makeService();
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-02']) cols[COL_DAILY].rows.set(d, { _id: d, m: {}, schemaV: 1 });
    const r = await svc.listDaily({ from: '2026-10-01', to: '2026-10-31' });
    expect(r).toMatchObject({ total: 2, page: 1, limit: 400 });
    expect(r.items.map((i) => i.date)).toEqual(['2026-10-01', '2026-10-02']);
    await expect(svc.listDaily({ from: '2026-10' })).rejects.toThrow('ГГГГ-ММ-ДД');
    await expect(svc.listMonthly({ to: '2026-10-01' })).rejects.toThrow('ГГГГ-ММ');
    expect((await svc.listMonthly({})).items).toEqual([]);
  });

  it('catalog: все показатели с подписью источника', () => {
    const { svc } = makeService();
    const c = svc.catalog();
    expect(c.total).toBe(c.items.length);
    expect(c.items.every((i) => i.sourceNote && i.groupLabel)).toBe(true);
  });
});

describe('collectNow: сбой источника = null, не 0', () => {
  it('база не отвечает — все показатели из базы null, счётчик задержек сохраняется', async () => {
    const boom = () => { throw new Error('нет базы'); };
    const db = { collection: boom, stats: boom, command: boom, client: { db: boom } };
    const h = new LatencyHistogram();
    h.observe(30); h.observe(2000, 502);
    const m = await collectNow({
      db: db as never, now: new Date(), latency: h.snapshot(),
      fillTotals: async () => { throw new Error('x'); }, integrityIssues: async () => { throw new Error('x'); },
    });
    expect(m['speed.requests']).toBe(2);
    expect(m['speed.slow_count']).toBe(1);
    expect(m['errors.http5xx']).toBe(1);
    expect(m['errors.total']).toBeNull();
    expect(m['business.requests_open']).toBeNull();
    expect(m['data.fill_total']).toBeNull();
  });

  it('без единого запроса скорость null: «нет данных», а не 0', async () => {
    const m = await collectNow({
      db: { collection: () => { throw new Error('x'); }, stats: () => { throw new Error('x'); }, command: () => { throw new Error('x'); }, client: { db: () => { throw new Error('x'); } } } as never,
      now: new Date(), latency: new LatencyHistogram().snapshot(), fillTotals: async () => ({ total: 4, top: 3 }), integrityIssues: async () => 0,
    });
    expect(m['speed.p95_ms']).toBeNull();
    expect(m['data.fill_total']).toBe(4);
    expect(m['data.integrity_issues']).toBe(0);
  });
});
