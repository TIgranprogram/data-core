import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Connection, Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { escapeRe, oid, parseList } from '../../common/list-query';
import { areaOf, buildSessions, maskSecrets, parseSubject, placeOf, weekStart } from './devlog-calc';
import { ImportDto, PatchItemDto, PatchSessionDto } from './dto/devlog.dto';
import { DevlogCommit, DevlogDoc, DevlogItem, DevlogKit, DevlogRelease, DevlogSession } from './devlog.schemas';

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const round = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DevlogService {
  constructor(
    @InjectModel(DevlogRelease.name) private readonly releases: Model<DevlogRelease>,
    @InjectModel(DevlogCommit.name) private readonly commits: Model<DevlogCommit>,
    @InjectModel(DevlogSession.name) private readonly sessions: Model<DevlogSession>,
    @InjectModel(DevlogItem.name) private readonly items: Model<DevlogItem>,
    @InjectModel(DevlogDoc.name) private readonly docs: Model<DevlogDoc>,
    @InjectModel(DevlogKit.name) private readonly kit: Model<DevlogKit>,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  /** Идемпотентный приём: upsert по ключам; ручные поля и ручные записи не затираются. */
  async importAll(dto: ImportDto) {
    const r = { commits: 0, items: 0, errors: 0, docs: 0, kit: 0, sessions: 0, releases: 0 };
    if (dto.commits?.length) {
      const res = await this.commits.bulkWrite(
        dto.commits.map((c) => {
          const p = parseSubject(c.subject);
          const set: Record<string, unknown> = {
            date: new Date(c.date), day: c.date.slice(0, 10), subject: cut(maskSecrets(c.subject), 300),
            prefix: p.prefix, area: areaOf(p.scope, c.paths), place: placeOf(c.footer),
          };
          if (c.releaseVersion) set.releaseVersion = c.releaseVersion;
          return { updateOne: { filter: { hash: c.hash }, update: { $set: set }, upsert: true } };
        }) as never,
      );
      r.commits = res.upsertedCount;
    }
    if (dto.items?.length) r.items = await this.importItems(dto);
    if (dto.syncErrors) r.errors = await this.syncErrors();
    if (dto.docs?.length) {
      const now = new Date();
      const res = await this.docs.bulkWrite(
        dto.docs.map((d) => ({
          updateOne: {
            filter: { path: d.path },
            update: {
              $set: {
                title: cut(maskSecrets(d.title), 300), kind: d.kind, text: maskSecrets(d.text),
                sha256: createHash('sha256').update(d.text).digest('hex'), importedAt: now,
                ...(d.closedAt ? { closedAt: new Date(d.closedAt) } : {}),
              },
            },
            upsert: true,
          },
        })) as never,
      );
      r.docs = res.upsertedCount;
    }
    if (dto.kit?.length) {
      const res = await this.kit.bulkWrite(
        dto.kit.map((k) => ({
          updateOne: {
            filter: { path: k.path },
            update: { $set: { text: maskSecrets(k.text), sha256: createHash('sha256').update(k.text).digest('hex'), version: dto.kitVersion } },
            upsert: true,
          },
        })) as never,
      );
      r.kit = res.upsertedCount;
    }
    if (dto.commits?.length) Object.assign(r, await this.rebuild());
    return r;
  }

  private async importItems(dto: ImportDto): Promise<number> {
    const list = dto.items ?? [];
    const manual = new Set(
      (await this.items.find({ key: { $in: list.map((i) => i.key) }, manual: true }).lean()).map((i) => i.key),
    );
    const todo = list.filter((i) => !manual.has(i.key));
    if (!todo.length) return 0;
    const res = await this.items.bulkWrite(
      todo.map((i) => ({
        updateOne: {
          filter: { key: i.key },
          update: {
            $set: {
              title: cut(maskSecrets(i.title), 300), area: i.area, status: i.status,
              ...(i.file ? { 'refs.file': i.file } : {}), ...(i.closedAt ? { closedAt: new Date(i.closedAt) } : {}),
            },
            $setOnInsert: { type: i.type, manual: false },
          },
          upsert: true,
        },
      })) as never,
    );
    return res.upsertedCount;
  }

  /** Копия групп ошибок по sig (без stack) — до истечения TTL 30 дней. После fixed новая ошибка → снова new, returned. */
  async syncErrors(): Promise<number> {
    const groups = (await this.conn
      .collection('clienterrors')
      .aggregate([
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$sig', count: { $sum: 1 }, firstAt: { $min: '$createdAt' }, lastAt: { $max: '$createdAt' }, message: { $first: '$message' }, section: { $first: '$section' }, version: { $last: '$version' } } },
      ])
      .toArray()) as { _id: string; count: number; firstAt: Date; lastAt: Date; message: string; section?: string; version?: string }[];
    if (!groups.length) return 0;
    const have = new Map(
      (await this.items.find({ key: { $in: groups.map((g) => `err:${g._id}`) } }).lean()).map((i) => [i.key, i]),
    );
    const res = await this.items.bulkWrite(
      groups.map((g) => {
        const old = have.get(`err:${g._id}`);
        const back = !!old && old.status === 'fixed' && g.lastAt > (old.closedAt ?? (old as { updatedAt?: Date }).updatedAt ?? g.lastAt);
        const set: Record<string, unknown> = { count: g.count, lastAt: g.lastAt, version: g.version, ...(back ? { status: 'new', returned: true } : {}) };
        if (!old || g.firstAt < (old.firstAt ?? g.firstAt)) set.firstAt = g.firstAt;
        return {
          updateOne: {
            filter: { key: `err:${g._id}` },
            update: {
              $set: set,
              ...(old ? {} : { $setOnInsert: { type: 'error', title: cut(maskSecrets(g.message ?? ''), 300), area: g.section, status: 'new', manual: false } }),
            },
            upsert: true,
          },
        };
      }) as never,
    );
    return res.upsertedCount;
  }

  /** Пересчёт кэша: сессии (с метками коммитов) и версии. Ручные часы сессий сохраняются. */
  async rebuild() {
    const all = await this.commits.find().lean();
    const calc = buildSessions(all.map((c) => ({ hash: c.hash, date: c.date, place: c.place })));
    const byHash = new Map(all.map((c) => [c.hash, c]));
    if (calc.length) {
      await this.sessions.bulkWrite(
        calc.map((s) => ({
          updateOne: {
            filter: { key: s.key },
            update: { $set: { start: s.start, end: s.end, day: byHash.get(s.hashes[0])?.day, hours: s.hours, commits: s.hashes.length, place: s.place } },
            upsert: true,
          },
        })) as never,
      );
      await this.commits.bulkWrite(
        calc.flatMap((s) => s.hashes.map((h) => ({ updateOne: { filter: { hash: h }, update: { $set: { sessionKey: s.key } } } }))) as never,
      );
    }
    const keys = new Set(calc.map((s) => s.key));
    const stale = (await this.sessions.find().lean()).filter((s) => !keys.has(s.key) && s.manualHours == null).map((s) => s.key);
    if (stale.length) await this.sessions.deleteMany({ key: { $in: stale } });

    const groups = new Map<string, typeof all>();
    for (const c of all) if (c.releaseVersion) groups.set(c.releaseVersion, [...(groups.get(c.releaseVersion) ?? []), c]);
    if (groups.size) {
      await this.releases.bulkWrite(
        [...groups].map(([version, cs]) => {
          const feats = cs.filter((c) => c.prefix === 'feat').length, fixes = cs.filter((c) => c.prefix === 'fix').length;
          return {
            updateOne: {
              filter: { version },
              update: {
                $set: { date: new Date(Math.max(...cs.map((c) => c.date.getTime()))), commits: cs.map((c) => c.hash) },
                $setOnInsert: { summary: `Изменений: ${cs.length}${feats ? `, новое: ${feats}` : ''}${fixes ? `, исправлений: ${fixes}` : ''}` },
              },
              upsert: true,
            },
          };
        }) as never,
      );
    }
    return { sessions: calc.length, releases: groups.size };
  }

  private page(q: Record<string, unknown>, sortable: string[], defaultSort: string) {
    return parseList(q, { sortable, defaultSort, defaultLimit: 50, maxLimit: 200 });
  }

  async listReleases(q: Record<string, unknown>) {
    const p = this.page(q, ['date', 'version'], '-date');
    const [rows, total] = await Promise.all([
      this.releases.find().sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.releases.countDocuments(),
    ]);
    const hashes = rows.flatMap((r) => r.commits);
    const cs = await this.commits.find({ hash: { $in: hashes } }).sort({ date: -1 }).select('hash date prefix area subject place').lean();
    const byHash = new Map(cs.map((c) => [c.hash, c]));
    const items = rows.map((r) => ({ ...r, commitCount: r.commits.length, commits: r.commits.map((h) => byHash.get(h)).filter(Boolean) }));
    return { items, total, page: p.page, limit: p.limit };
  }

  async listSessions(q: Record<string, unknown>) {
    const p = this.page(q, ['start', 'hours'], '-start');
    const range = this.range(q);
    const filter = range ? { start: range } : {};
    const [rows, total] = await Promise.all([
      this.sessions.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.sessions.countDocuments(filter),
    ]);
    return { items: rows.map((s) => ({ ...s, effectiveHours: s.manualHours ?? s.hours })), total, page: p.page, limit: p.limit };
  }

  private range(q: Record<string, unknown>) {
    const r: Record<string, Date> = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.from ?? ''))) r.$gte = new Date(`${q.from}T00:00:00Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.to ?? ''))) r.$lt = new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400_000);
    return Object.keys(r).length ? r : undefined;
  }

  async patchSession(id: string, dto: PatchSessionDto) {
    const upd = dto.manualHours == null ? { $unset: { manualHours: 1 } } : { $set: { manualHours: dto.manualHours } };
    const s = await this.sessions.findByIdAndUpdate(oid(id, 'сессии'), upd, { new: true }).lean();
    if (!s) throw new NotFoundException('Сессия не найдена');
    return { ...s, effectiveHours: s.manualHours ?? s.hours };
  }

  /** Часы по неделям, разделам и префиксам. `manual=1` — с ручными правками; часы сессии делятся поровну на её коммиты. */
  async stats(q: Record<string, unknown>) {
    const useManual = q.manual === '1' || q.manual === 'true';
    const range = this.range(q);
    const ss = await this.sessions.find(range ? { start: range } : {}).lean();
    const hoursOf = (s: DevlogSession) => (useManual ? s.manualHours ?? s.hours : s.hours);
    const share = new Map(ss.map((s) => [s.key, hoursOf(s) / Math.max(1, s.commits)]));
    const cs = ss.length ? await this.commits.find({ sessionKey: { $in: [...share.keys()] } }).select('prefix area sessionKey').lean() : [];
    const sum = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    const byWeek = new Map<string, number>(), byArea = new Map<string, number>(), byPrefix = new Map<string, number>();
    for (const s of ss) sum(byWeek, weekStart(s.day ?? s.start.toISOString().slice(0, 10)), hoursOf(s));
    for (const c of cs) {
      const h = share.get(c.sessionKey as string) ?? 0;
      sum(byArea, c.area ?? 'без раздела', h);
      sum(byPrefix, c.prefix ?? 'без префикса', h);
    }
    const list = (m: Map<string, number>, key: string, sort: boolean) => {
      const a = [...m].map(([k, h]) => ({ [key]: k, hours: round(h) }));
      return sort ? a.sort((x, y) => (y.hours as number) - (x.hours as number)) : a.sort((x, y) => String(x[key]).localeCompare(String(y[key])));
    };
    return {
      manual: useManual,
      totalHours: round([...ss].reduce((n, s) => n + hoursOf(s), 0)),
      sessions: ss.length,
      commits: cs.length,
      byWeek: list(byWeek, 'week', false),
      byArea: list(byArea, 'area', true),
      byPrefix: list(byPrefix, 'prefix', true),
      note: 'Оценка по коммитам, погрешность ±30–40 %',
    };
  }

  async listItems(q: Record<string, unknown>) {
    const p = this.page(q, ['lastAt', 'createdAt', 'count', 'title'], '-lastAt');
    const f: Record<string, unknown> = {};
    for (const k of ['type', 'status', 'area']) if (q[k]) f[k] = String(q[k]);
    if (p.search) f.title = p.search;
    const [items, total] = await Promise.all([
      this.items.find(f).sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.items.countDocuments(f),
    ]);
    return { items, total, page: p.page, limit: p.limit };
  }

  async patchItem(id: string, dto: PatchItemDto) {
    const set: Record<string, unknown> = { manual: true };
    if (dto.status) set.status = dto.status;
    if (dto.status === 'fixed') set.closedAt = new Date();
    if (dto.note !== undefined) set.note = dto.note;
    if (dto.hours !== undefined) set.hours = dto.hours;
    if (dto.fixCommit) set['refs.fixCommit'] = dto.fixCommit;
    if (dto.fixVersion) set['refs.fixVersion'] = dto.fixVersion;
    const upd: Record<string, unknown> = { $set: set };
    if (dto.status && dto.status !== 'new') upd.$unset = { returned: 1 };
    const it = await this.items.findByIdAndUpdate(oid(id, 'записи'), upd, { new: true }).lean();
    if (!it) throw new NotFoundException('Запись не найдена');
    return it;
  }

  /** Список без текста; `?path=` — точное совпадение с sha256 для сверки перед удалением из репозитория. */
  async listDocs(q: Record<string, unknown>) {
    const p = this.page(q, ['importedAt', 'path', 'title'], '-importedAt');
    const f: Record<string, unknown> = {};
    if (q.kind) f.kind = String(q.kind);
    if (q.path) f.path = String(q.path);
    if (p.search) {
      const re = new RegExp(escapeRe(String(q.search).trim()), 'i');
      f.$or = [{ title: re }, { path: re }, { text: re }];
    }
    const [items, total] = await Promise.all([
      this.docs.find(f).sort(p.sort).skip(p.skip).limit(p.limit).select('-text').lean(),
      this.docs.countDocuments(f),
    ]);
    return { items, total, page: p.page, limit: p.limit };
  }

  /** Снимок набора: файлы для zip (путь → текст). */
  async kitFiles(): Promise<{ path: string; text: string }[]> {
    return this.kit.find().sort({ path: 1 }).select('path text').lean();
  }

  async getDoc(id: string) {
    const d = await this.docs.findById(oid(id, 'документа')).lean();
    if (!d) throw new NotFoundException('Документ не найден');
    return d;
  }
}
