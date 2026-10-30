import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { latency } from '../../common/interceptors/latency-histogram';
import { FillAuditService } from '../fill-audit/fill-audit.service';
import { IntegrityService } from '../disk/integrity';
import { METRICS, METRIC_GROUPS, sourceNote } from './control.catalog';
import { collectNow, type CollectDeps } from './control.collect';
import {
  DAILY_KEEP_DAYS, DAY_MS, diskHistoryToMetrics, emptyMetrics, isDay, isMonth, monthOf, rollupMonth, ymd, type Metrics,
} from './control.rollup';
import { runId, runKeepUntil, runMetrics, type RunDoc } from './control.runs';
import type { ControlRangeQuery, CreateRunDto } from './dto/control.dto';

export const COL_RUNS = 'app_control_runs';
export const COL_DAILY = 'app_control_daily';
export const COL_MONTHLY = 'app_control_monthly';
/** Версия формата дневной точки: растёт, когда меняется смысл ключей. */
export const DAILY_SCHEMA_V = 1;
/** Время снимка дня по часам сервера. */
export const SNAPSHOT_AT = '23:30';

/**
 * CC-10…13: показатели сайта по дням. Коллекции — без Mongoose и плагинов (soft-delete, аудит):
 * запись идёт напрямую драйвером, чтобы метрики не раздували `auditlogs`.
 */
@Injectable()
export class ControlService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Control');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** За какое число снимок уже сделан этим процессом (чтобы не ходить в базу каждую минуту). */
  private doneDay = '';

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly fill?: FillAuditService,
    @Optional() private readonly integrity?: IntegrityService,
  ) {}

  private get db() { return this.connection.db!; }
  private runs() { return this.db.collection<RunDoc>(COL_RUNS); }
  private daily() { return this.db.collection<{ _id: string; m: Metrics; schemaV: number; meta?: Record<string, unknown> }>(COL_DAILY); }
  private monthly() { return this.db.collection<{ _id: string; m: Record<string, unknown>; days: number; schemaV: number }>(COL_MONTHLY); }

  async onModuleInit() {
    try {
      await this.ensureIndexes();
      await this.mergeDiskHistory();
    } catch (e) { this.log.warn(`подготовка коллекций показателей: ${(e as Error).message}`); }
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.tick(), 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** TTL: запись стирается, когда наступает `keepUntil` (90 дней; у прогонов с провалом — год). */
  async ensureIndexes() {
    await this.runs().createIndex({ keepUntil: 1 }, { expireAfterSeconds: 0 });
    await this.runs().createIndex({ receivedAt: -1 });
  }

  /** Раз в минуту: после 23:30 один раз за сутки делаем снимок. Ошибка не роняет сервер. */
  async tick(now = new Date()) {
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = ymd(now);
    if (hm < SNAPSHOT_AT || this.doneDay === today || this.busy) return;
    this.busy = true;
    try {
      await this.snapshotDay(now);
      this.doneDay = today;
    } catch (e) { this.log.warn(`снимок дня: ${(e as Error).message}`); } finally { this.busy = false; }
  }

  private deps(now: Date): CollectDeps {
    return {
      db: this.db,
      now,
      latency: latency.snapshot(true, now),
      fillTotals: async () => {
        if (!this.fill) throw new Error('нет fill-audit');
        const r = await this.fill.report({ role: 'admin', isOwner: true }, { limit: 1 });
        return { total: r.total, top: Math.max(0, ...r.groups.map((g) => g.count)) };
      },
      integrityIssues: async () => {
        if (!this.integrity) throw new Error('нет integrity');
        return (await this.integrity.report()).issues.reduce((s, i) => s + i.count, 0);
      },
    };
  }

  /**
   * Снимок дня (CC-12). Идемпотентно: за число уже есть снимок — ничего не делаем и счётчик задержек не трогаем;
   * `force` пересчитывает (значения null не затирают то, что уже записано).
   */
  async snapshotDay(now = new Date(), opts: { force?: boolean; collect?: (d: CollectDeps) => Promise<Metrics> } = {}) {
    const date = ymd(now);
    const col = this.daily();
    const had = await col.findOne({ _id: date });
    if (had?.meta?.source === 'snapshot' && !opts.force) return { date, created: false };

    const deps = this.deps(now);
    const lat = deps.latency;
    const lastRun = await this.runs().find({ receivedAt: { $gte: new Date(now.getTime() - DAY_MS) } }).sort({ receivedAt: -1 }).limit(1).toArray();
    const fresh: Metrics = { ...(await (opts.collect ?? collectNow)(deps)), ...runMetrics(lastRun[0]) };

    const m: Metrics = { ...emptyMetrics(), ...(had?.m ?? {}) };
    for (const [k, v] of Object.entries(fresh)) if (v !== null && v !== undefined) m[k] = v;
    await col.updateOne(
      { _id: date },
      {
        $set: {
          m, schemaV: DAILY_SCHEMA_V,
          meta: {
            source: 'snapshot', takenAt: now,
            // счётчик задержек живёт в памяти: после перезапуска он считает не все сутки
            latencySince: lat.since, latencyPartial: now.getTime() - lat.since.getTime() < 23 * 3600_000,
          },
        },
      },
      { upsert: true },
    );
    await this.rollMonth(monthOf(date));
    await this.cleanup(now);
    return { date, created: !had };
  }

  /** Влить `disk_usage_history` в дневные точки (старую коллекцию не трогаем). Идемпотентно. */
  async mergeDiskHistory() {
    const hist = await this.db.collection('disk_usage_history').find({}, { projection: { _id: 1, usedBytes: 1, totalBytes: 1 } }).toArray();
    let merged = 0;
    const months = new Set<string>();
    for (const h of hist) {
      const date = String(h._id);
      if (!isDay(date)) continue;
      const disk = diskHistoryToMetrics(h as { usedBytes?: unknown; totalBytes?: unknown });
      if (!Object.keys(disk).length) continue;
      const had = await this.daily().findOne({ _id: date });
      if (had && had.m['storage.disk_used_pct'] != null && had.m['storage.disk_used_bytes'] != null) continue;
      const m: Metrics = { ...emptyMetrics(), ...(had?.m ?? {}) };
      for (const [k, v] of Object.entries(disk)) if (m[k] == null) m[k] = v ?? null;
      await this.daily().updateOne({ _id: date }, { $set: { m }, $setOnInsert: { schemaV: DAILY_SCHEMA_V, meta: { source: 'disk_usage_history' } } }, { upsert: true });
      months.add(monthOf(date));
      merged++;
    }
    for (const mo of months) await this.rollMonth(mo);
    return { merged };
  }

  /** Свёртка месяца из его дневных точек. Не перезаписывает свёртку, если дней стало меньше (часть уже стёрта). */
  async rollMonth(month: string) {
    const days = await this.daily().find({ _id: { $gte: `${month}-01`, $lte: `${month}-31` } }).toArray();
    const prev = await this.monthly().findOne({ _id: month });
    if (!days.length || (prev && prev.days > days.length)) return { month, days: prev?.days ?? 0, written: false };
    await this.monthly().updateOne(
      { _id: month },
      { $set: { m: rollupMonth(days), days: days.length, schemaV: DAILY_SCHEMA_V, updatedAt: new Date() } },
      { upsert: true },
    );
    return { month, days: days.length, written: true };
  }

  /** Стереть дневные точки старше 400 дней — только после того, как месяц свёрнут и проверен. */
  async cleanup(now = new Date()) {
    const cutoff = ymd(new Date(now.getTime() - DAILY_KEEP_DAYS * DAY_MS));
    const old = await this.daily().find({ _id: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray();
    let removed = 0;
    for (const month of new Set(old.map((d) => monthOf(d._id)))) {
      await this.rollMonth(month);
      const [mo, total] = await Promise.all([
        this.monthly().findOne({ _id: month }),
        this.daily().countDocuments({ _id: { $gte: `${month}-01`, $lte: `${month}-31` } }),
      ]);
      if (!mo || mo.days < total) continue; // свёртка неполна — дни остаются
      removed += (await this.daily().deleteMany({ _id: { $gte: `${month}-01`, $lt: cutoff } })).deletedCount ?? 0;
    }
    return { removed };
  }

  /** CC-13: принять summary.json ночного прогона. Повтор того же прогона заменяет запись, а не плодит дубль. */
  async ingestRun(dto: CreateRunDto, now = new Date()) {
    if (Number.isNaN(Date.parse(dto.date))) throw new BadRequestException('Дата прогона указана неверно (нужен формат ГГГГ-ММ-ДДTчч:мм:сс)');
    const node = (dto.node ?? 'pc').trim() || 'pc';
    const _id = runId(dto.date, dto.commit, node);
    const { node: _n, ...rest } = dto;
    void _n;
    const set = { ...rest, node, keepUntil: runKeepUntil(now, dto.red) };
    const r = await this.runs().updateOne({ _id }, { $set: set, $setOnInsert: { receivedAt: now } }, { upsert: true });
    return { id: _id, created: r.upsertedCount === 1 };
  }

  private range(q: ControlRangeQuery, valid: (s: unknown) => boolean, what: string) {
    for (const v of [q.from, q.to]) if (v !== undefined && !valid(v)) throw new BadRequestException(`Период указан неверно: нужен формат ${what}`);
    const f: Record<string, string> = {};
    if (q.from) f.$gte = q.from;
    if (q.to) f.$lte = q.to;
    return Object.keys(f).length ? { _id: f } : {};
  }

  async listDaily(q: ControlRangeQuery) {
    const filter = this.range(q, isDay, 'ГГГГ-ММ-ДД');
    const page = q.page ?? 1, limit = q.limit ?? 400;
    const [docs, total] = await Promise.all([
      this.daily().find(filter).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.daily().countDocuments(filter),
    ]);
    return { items: docs.map((d) => ({ ...d, date: d._id })), total, page, limit };
  }

  async listMonthly(q: ControlRangeQuery) {
    const filter = this.range(q, isMonth, 'ГГГГ-ММ');
    const page = q.page ?? 1, limit = q.limit ?? 120;
    const [docs, total] = await Promise.all([
      this.monthly().find(filter).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.monthly().countDocuments(filter),
    ]);
    return { items: docs.map((d) => ({ ...d, month: d._id })), total, page, limit };
  }

  catalog() {
    const items = METRICS.map((d) => ({ ...d, sourceNote: sourceNote(d), groupLabel: METRIC_GROUPS[d.group] }));
    return { items, total: items.length, page: 1, limit: items.length, groups: METRIC_GROUPS };
  }
}
