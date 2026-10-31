import { Injectable, NestMiddleware, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * БЗ-19: подозрительные запросы. Ответы 401/403/404 и неудачные входы считаются по адресу в памяти,
 * раз в 5 минут агрегат уходит в `security_events` (по строке на адрес и день, TTL 30 дней).
 * На каждый запрос записи в базу нет.
 */
export const SECURITY_TTL_DAYS = 30;
const MAX_IPS = 2000;
export interface SecCounters { c401: number; c403: number; c404: number; loginFail: number }
const zero = (): SecCounters => ({ c401: 0, c403: 0, c404: 0, loginFail: 0 });

export class SecurityTracker {
  private map = new Map<string, SecCounters>();

  record(ip: string, status: number, url: string) {
    const isLogin = /\/auth\/login(\?|$)/.test(url);
    const bad = status === 401 || status === 403 || status === 404;
    if (!bad && !(isLogin && status === 429)) return;
    let c = this.map.get(ip);
    if (!c) {
      if (this.map.size >= MAX_IPS) return;
      c = zero(); this.map.set(ip, c);
    }
    if (status === 401) c.c401++; else if (status === 403) c.c403++; else if (status === 404) c.c404++;
    if (isLogin && (status === 401 || status === 429)) c.loginFail++;
  }

  /** Забрать накопленное и обнулить. */
  drain(): [string, SecCounters][] {
    const out = [...this.map.entries()];
    this.map = new Map();
    return out;
  }
}

export const tracker = new SecurityTracker();

/** Топ адресов по строкам security_events: сумма за период, самые «шумные» сверху. */
export function topIps(rows: Array<{ ip: string } & SecCounters>, limit = 20) {
  const by = new Map<string, { ip: string; total: number } & SecCounters>();
  for (const r of rows) {
    const x = by.get(r.ip) ?? { ip: r.ip, total: 0, ...zero() };
    x.c401 += r.c401 || 0; x.c403 += r.c403 || 0; x.c404 += r.c404 || 0; x.loginFail += r.loginFail || 0;
    x.total = x.c401 + x.c403 + x.c404;
    by.set(r.ip, x);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || b.loginFail - a.loginFail).slice(0, limit);
}

@Injectable()
export class SecurityService implements OnModuleDestroy {
  private timer: NodeJS.Timeout;
  constructor(@InjectConnection() private readonly connection: Connection) {
    this.timer = setInterval(() => { void this.flush(); }, 5 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { clearInterval(this.timer); void this.flush(); }

  private col() { return this.connection.db!.collection('security_events'); }

  async flush() {
    const rows = tracker.drain();
    if (!rows.length || !this.connection.db) return;
    const day = new Date().toISOString().slice(0, 10);
    const expireAt = new Date(Date.now() + SECURITY_TTL_DAYS * 86400_000);
    const col = this.col();
    await col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => undefined);
    await col.bulkWrite(rows.map(([ip, c]) => ({
      updateOne: {
        filter: { ip, day },
        update: { $inc: { c401: c.c401, c403: c.c403, c404: c.c404, loginFail: c.loginFail }, $set: { expireAt } },
        upsert: true,
      },
    })), { ordered: false }).catch(() => undefined);
  }

  /** GET /health/security?days=1 — топ адресов за период. */
  async report(days: number) {
    await this.flush();
    const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const rows = await this.col().find({ day: { $gte: from } }).limit(5000).toArray();
    return { days, items: topIps(rows as unknown as Array<{ ip: string } & SecCounters>) };
  }

  /** GET /health/visits — последний вход по пользователям и число действий (записи в auditlogs) за период. */
  async visits(days: number) {
    const since = new Date(Date.now() - days * 86400_000);
    const db = this.connection.db!;
    const [users, acts] = await Promise.all([
      db.collection('users').find({ lastLoginAt: { $gte: since }, deletedAt: null }, { projection: { username: 1, fullName: 1, role: 1, lastLoginAt: 1 } })
        .sort({ lastLoginAt: -1 }).limit(200).toArray(),
      db.collection('auditlogs').aggregate([
        { $match: { createdAt: { $gte: since }, userName: { $ne: null } } },
        { $group: { _id: '$userName', actions: { $sum: 1 }, lastAt: { $max: '$createdAt' }, sections: { $addToSet: '$entityType' } } },
        { $sort: { actions: -1 } }, { $limit: 100 },
      ]).toArray(),
    ]);
    return {
      days,
      logins: users.map((u) => ({ username: u.username, name: u.fullName ?? null, role: u.role ?? null, lastLoginAt: u.lastLoginAt })),
      activity: acts.map((a) => ({ user: a._id, actions: a.actions, lastAt: a.lastAt, sections: (a.sections as string[]).slice(0, 10) })),
    };
  }
}

/** Считает ответы в самом начале цепочки — видит и отказы guard'ов, и 404 без маршрута. */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: { ip?: string; originalUrl?: string; url?: string }, res: { statusCode: number; on(ev: string, cb: () => void): void }, next: () => void) {
    res.on('finish', () => tracker.record(req.ip || '?', res.statusCode, req.originalUrl || req.url || ''));
    next();
  }
}
