import { promises as fs } from 'fs';
import path from 'path';
import type { Connection } from 'mongoose';
import { dirSize, exists } from '../disk/disk-fs';
import { DAY_MS, emptyMetrics, type Metrics } from './control.rollup';
import type { LatencySnapshot } from '../../common/interceptors/latency-histogram';

type Db = NonNullable<Connection['db']>;

/** Что нужно сборщику от соседних модулей (только чтение; в spec подменяется). */
export interface CollectDeps {
  db: Db;
  now: Date;
  latency: LatencySnapshot;
  fillTotals: () => Promise<{ total: number; top: number }>;
  integrityIssues: () => Promise<number>;
}

/** Не получилось посчитать — null (не 0): на экране «нет данных». */
async function safe(fn: () => Promise<number | null>): Promise<number | null> {
  try {
    const v = await fn();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const hoursSince = (at: Date | undefined | null, now: Date) => (at ? Math.round(((now.getTime() - at.getTime()) / 3_600_000) * 10) / 10 : null);

/**
 * CC-12: показатели «сейчас» — только то, что считается дёшево из уже имеющихся данных (окно — последние 24 часа).
 * Остальное остаётся null; список — `control.catalog.ts`.
 */
export async function collectNow(d: CollectDeps): Promise<Metrics> {
  const { db, now, latency } = d;
  const since = new Date(now.getTime() - DAY_MS);
  const m = emptyMetrics();

  // скорость и сбои 5xx — из счётчика в памяти
  if (latency.requests > 0) {
    m['speed.requests'] = latency.requests;
    m['speed.p50_ms'] = latency.p50;
    m['speed.p95_ms'] = latency.p95;
    m['speed.slow_count'] = latency.slow;
    m['errors.http5xx'] = latency.errors5xx;
  }

  const errs = () => db.collection('clienterrors');
  const host = process.env.HOST_DATA_DIR || '/host-data';
  const mounted = await exists(host);
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const alive = { deletedAt: null };
  const openReq = { ...alive, status: { $in: ['in_progress', 'requested', 'ordered'] } };

  const jobs: Array<[string, () => Promise<number | null>]> = [
    ['errors.total', () => errs().countDocuments({ createdAt: { $gte: since } })],
    ['errors.unhandled', () => errs().countDocuments({ createdAt: { $gte: since }, kind: 'unhandled' })],
    ['errors.new_kinds', async () => {
      const today = (await errs().distinct('sig', { createdAt: { $gte: since } })) as string[];
      if (!today.length) return 0;
      const old = new Set((await errs().distinct('sig', { sig: { $in: today }, createdAt: { $lt: since } })) as string[]);
      return today.filter((s) => !old.has(s)).length;
    }],
    ['data.fill_total', async () => (await d.fillTotals()).total],
    ['data.fill_top', async () => (await d.fillTotals()).top],
    ['data.integrity_issues', () => d.integrityIssues()],
    ['business.requests_open', () => db.collection('supplyrequests').countDocuments(openReq)],
    ['business.requests_overdue', () => db.collection('supplyrequests').countDocuments({ ...openReq, neededBy: { $lt: now } })],
    ['business.orders_active', () => db.collection('salesorders').countDocuments({ ...alive, stage: { $nin: ['shipped', 'closed', 'cancelled'] } })],
    ['business.stock_moves', () => db.collection('stockmovements').countDocuments({ createdAt: { $gte: since } })],
    ['business.users_active', async () => ((await db.collection('auditlogs').distinct('userId', { createdAt: { $gte: since } })) as unknown[]).length],
    ['business.passports_issued', () => db.collection('productpassports').countDocuments({ ...alive, issuedAt: { $gte: since } })],
    ['storage.db_bytes', async () => {
      const s = await db.stats();
      return Number(s.storageSize ?? 0) + Number(s.indexSize ?? 0);
    }],
    ['storage.auditlogs_bytes', async () => {
      const s = (await db.command({ collStats: 'auditlogs' })) as Record<string, unknown>;
      return Number(s.storageSize ?? 0) + Number(s.totalIndexSize ?? 0);
    }],
    ['storage.oplog_hours', async () => {
      const oplog = db.client.db('local').collection('oplog.rs');
      const [first] = await oplog.find({}, { projection: { ts: 1 } }).sort({ $natural: 1 }).limit(1).toArray();
      const [last] = await oplog.find({}, { projection: { ts: 1 } }).sort({ $natural: -1 }).limit(1).toArray();
      if (!first?.ts || !last?.ts) return null;
      return Math.round(((last.ts.getHighBits() - first.ts.getHighBits()) / 3600) * 10) / 10;
    }],
    ['storage.uploads_bytes', async () => (await dirSize(mounted ? path.join(host, 'uploads') : uploadsDir)).bytes],
    ['storage.backups_bytes', async () => (mounted ? (await dirSize(path.join(host, 'backups'))).bytes : null)],
    ['storage.disk_used_pct', async () => {
      const root = mounted ? host : (await exists(uploadsDir)) ? uploadsDir : process.cwd();
      const st = await fs.statfs(root);
      const total = st.blocks * st.bsize;
      return total > 0 ? Math.round(((total - st.bavail * st.bsize) / total) * 1000) / 10 : null;
    }],
    ['storage.disk_used_bytes', async () => {
      const root = mounted ? host : (await exists(uploadsDir)) ? uploadsDir : process.cwd();
      const st = await fs.statfs(root);
      return st.blocks * st.bsize - st.bavail * st.bsize;
    }],
    ['backups.local_age_h', async () => {
      if (!mounted) return null;
      const names = (await fs.readdir(path.join(host, 'backups'))).filter((n) => n.startsWith('mongo-'));
      if (!names.length) return null;
      const times = await Promise.all(names.map(async (n) => (await fs.stat(path.join(host, 'backups', n))).mtime));
      return hoursSince(new Date(Math.max(...times.map((t) => t.getTime()))), now);
    }],
    ['backups.offsite_age_h', async () => {
      const ok = await db.collection('backuptargets').find({ 'last.ok': true }, { projection: { 'last.at': 1 } }).toArray();
      const at = ok.map((t) => (t.last?.at as Date | undefined)?.getTime()).filter((x): x is number => typeof x === 'number');
      return at.length ? hoursSince(new Date(Math.max(...at)), now) : null;
    }],
  ];
  const vals = await Promise.all(jobs.map(([, fn]) => safe(fn)));
  jobs.forEach(([k], i) => { m[k] = vals[i]; });
  return m;
}
