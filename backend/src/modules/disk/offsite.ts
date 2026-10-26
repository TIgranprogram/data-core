import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import archiver from 'archiver';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { Readable, Transform } from 'stream';
import { Types, type Connection } from 'mongoose';
import { backupDirs, backupsRoot, latestBackupDate, STAMP_RE } from './backups';

/**
 * БКП (2026-10-26): копии вне дома. Цели WebDAV (Яндекс-Диск, Nextcloud, второй Synology…) — в таблице `backuptargets`,
 * настройки — там же документом `_id: 'settings'`. Раз в сутки в заданное время (и по кнопке) последняя копия
 * (`mongo-` + `uploads-` из HOST_DATA_DIR/backups) → zip → AES-256-GCM (пароль пользователя) → PUT во все включённые цели.
 * Пароли целей и шифрования лежат в базе зашифрованными ключом сервера (BACKUP_SECRET_KEY, иначе JWT_SECRET) и наружу не отдаются.
 * Расшифровка копии — backend/scripts/backup-decrypt.js.
 */

// ─── секреты в базе ─────────────────────────────────────────────────────────────────────────────
const serverKey = () => createHash('sha256').update(String(process.env.BACKUP_SECRET_KEY || process.env.JWT_SECRET || 'dev-only')).digest();
export function sealSecret(plain: string): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', serverKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function openSecret(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', serverKey(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ─── шифрование копии: «DCB1» + соль 16 + iv 12 + данные + тег 16 (в конце) ─────────────────────
export const MAGIC = Buffer.from('DCB1');
export function encryptStream(password: string): Transform {
  const salt = randomBytes(16); const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  let head = false;
  return new Transform({
    transform(chunk, _e, cb) { if (!head) { head = true; this.push(Buffer.concat([MAGIC, salt, iv])); } cb(null, c.update(chunk)); },
    flush(cb) { if (!head) this.push(Buffer.concat([MAGIC, salt, iv])); this.push(c.final()); this.push(c.getAuthTag()); cb(); },
  });
}

// ─── WebDAV ─────────────────────────────────────────────────────────────────────────────────────
export interface Target { _id: Types.ObjectId; name: string; url: string; username: string; secret?: string; folder?: string; enabled: boolean; last?: { at: Date; ok: boolean; message: string; bytes?: number } }
const join = (base: string, ...parts: string[]) => [base.replace(/\/+$/, ''), ...parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean)].join('/');
const auth = (t: Target) => 'Basic ' + Buffer.from(`${t.username}:${t.secret ? openSecret(t.secret) : ''}`).toString('base64');
async function dav(t: Target, method: string, path: string, body?: BodyInit | Readable, extra: Record<string, string> = {}) {
  const res = await fetch(join(t.url, path), { method, headers: { Authorization: auth(t), ...extra }, body: body as BodyInit, ...(body instanceof Readable ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(6 * 3600e3) } as RequestInit);
  return res;
}
const davError = (res: Response, what: string) => new Error(res.status === 401 ? 'Неверный логин или пароль' : res.status === 404 ? 'Адрес или папка не найдены' : res.status === 507 ? 'На диске нет места' : `${what}: ответ ${res.status}`);
async function ensureFolder(t: Target) {
  if (!t.folder) return;
  let path = '';
  for (const part of t.folder.split('/').filter(Boolean)) { path = path ? `${path}/${part}` : part; const r = await dav(t, 'MKCOL', path + '/'); if (![201, 405, 301].includes(r.status) && r.status >= 400) throw davError(r, 'Папка'); }
}
/** Имена наших файлов в папке цели (PROPFIND, глубина 1). */
async function listRemote(t: Target): Promise<string[]> {
  const r = await dav(t, 'PROPFIND', (t.folder ?? '') + '/', undefined, { Depth: '1' });
  if (r.status >= 400) return [];
  const xml = await r.text();
  return [...xml.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)].map((m) => decodeURIComponent(m[1]).split('/').filter(Boolean).pop() ?? '').filter((n) => /^datacore-\d{4}-\d{2}-\d{2}_\d{6}\.dcb$/.test(n));
}

@Injectable()
export class OffsiteService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Offsite');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get coll() { return this.connection.db!.collection<Record<string, unknown>>('backuptargets'); }

  onModuleInit() { if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.tick(), 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async settings() {
    const s: Record<string, unknown> = (await this.coll.findOne({ _id: 'settings' as never })) ?? {};
    return { time: String(s.time ?? '04:30'), keep: Number(s.keep ?? 7), password: (s.password as string) ?? null, lastAuto: (s.lastAuto as string) ?? null };
  }

  /** Для админки: секреты — только «задан / нет». */
  async view() {
    const s = await this.settings();
    const targets = (await this.coll.find({ _id: { $ne: 'settings' as never } }).sort({ name: 1 }).toArray()) as unknown as Target[];
    return {
      settings: { time: s.time, keep: s.keep, hasPassword: !!s.password, lastAuto: s.lastAuto },
      targets: targets.map((t) => ({ id: String(t._id), name: t.name, url: t.url, username: t.username, folder: t.folder ?? '', enabled: t.enabled, hasSecret: !!t.secret, last: t.last ?? null })),
      latestBackup: (await latestBackupDate(backupsRoot())) ?? null,
    };
  }

  async saveSettings(b: { time?: unknown; keep?: unknown; password?: unknown }) {
    const set: Record<string, unknown> = {};
    if (b.time !== undefined) { const t = String(b.time); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new BadRequestException('Время — ЧЧ:ММ'); set.time = t; }
    if (b.keep !== undefined) { const k = Number(b.keep); if (!Number.isInteger(k) || k < 1 || k > 60) throw new BadRequestException('Хранить — от 1 до 60 копий'); set.keep = k; }
    if (b.password !== undefined) { const p = String(b.password ?? ''); if (p && p.length < 10) throw new BadRequestException('Пароль шифрования — не короче 10 знаков'); set.password = p ? sealSecret(p) : null; }
    await this.coll.updateOne({ _id: 'settings' as never }, { $set: set }, { upsert: true });
    return this.view();
  }

  async saveTarget(id: string | null, b: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    if (b.name !== undefined) set.name = String(b.name).trim().slice(0, 100) || 'Копии';
    if (b.url !== undefined) { const u = String(b.url).trim(); if (!/^https:\/\//i.test(u)) throw new BadRequestException('Адрес WebDAV — https://…'); set.url = u; }
    if (b.username !== undefined) set.username = String(b.username).trim().slice(0, 200);
    if (b.password !== undefined && String(b.password)) set.secret = sealSecret(String(b.password));
    if (b.folder !== undefined) set.folder = String(b.folder).trim().replace(/^\/+|\/+$/g, '').slice(0, 200);
    if (b.enabled !== undefined) set.enabled = !!b.enabled;
    if (id) {
      const r = await this.coll.updateOne({ _id: this.oid(id) as never }, { $set: set });
      if (!r.matchedCount) throw new NotFoundException('Цель не найдена');
    } else {
      if (!set.url || !set.username) throw new BadRequestException('Нужны адрес и логин');
      await this.coll.insertOne({ name: 'Копии', folder: 'datacore-backups', enabled: true, ...set });
    }
    return this.view();
  }

  async removeTarget(id: string) { await this.coll.deleteOne({ _id: this.oid(id) as never }); return this.view(); }

  /** «Проверить связь»: папка + маленький файл туда и обратно. */
  async test(id: string) {
    const t = await this.target(id);
    try {
      await ensureFolder(t);
      const name = join(t.folder ?? '', `datacore-test-${Date.now()}.txt`);
      const put = await dav(t, 'PUT', name, 'проверка связи data-core');
      if (put.status >= 400) throw davError(put, 'Запись');
      await dav(t, 'DELETE', name);
      return { ok: true, message: 'Связь есть: запись и удаление прошли' };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }

  /** Отправить последнюю копию во все включённые цели (или в одну). */
  async runAll(onlyId?: string) {
    if (this.running) throw new BadRequestException('Отправка уже идёт');
    const s = await this.settings();
    if (!s.password) throw new BadRequestException('Сначала задайте пароль шифрования');
    const latest = await latestBackupDate(backupsRoot());
    if (!latest) throw new BadRequestException('Копий на сервере нет');
    const stamp = latest.replace('T', '_').replace(/:/g, '').slice(0, 17);
    if (!STAMP_RE.test(stamp)) throw new BadRequestException('Не разобрать имя копии');
    const targets = ((await this.coll.find({ _id: { $ne: 'settings' as never }, enabled: true }).toArray()) as unknown as Target[]).filter((t) => !onlyId || String(t._id) === onlyId);
    if (!targets.length) throw new BadRequestException('Нет включённых целей');
    this.running = true;
    const out: Array<{ name: string; ok: boolean; message: string }> = [];
    try {
      for (const t of targets) {
        const r = await this.sendOne(t, stamp, openSecret(s.password), s.keep);
        out.push({ name: t.name, ...r });
      }
    } finally { this.running = false; }
    return { stamp, results: out };
  }

  private async sendOne(t: Target, stamp: string, password: string, keep: number) {
    const file = `datacore-${stamp}.dcb`;
    let bytes = 0;
    try {
      await ensureFolder(t);
      const dirs = await backupDirs(backupsRoot(), stamp, 'all');
      const zip = archiver('zip', { zlib: { level: 1 } });
      for (const [dir, inside] of dirs) zip.directory(dir, inside);
      void zip.finalize();
      const body = zip.pipe(encryptStream(password)).pipe(new Transform({ transform(c, _e, cb) { bytes += c.length; cb(null, c); } }));
      const res = await dav(t, 'PUT', join(t.folder ?? '', file), body as unknown as Readable);
      if (res.status >= 400) throw davError(res, 'Отправка');
      // ротация: оставить keep последних
      const names = (await listRemote(t)).sort();
      for (const old of names.slice(0, Math.max(0, names.length - keep))) await dav(t, 'DELETE', join(t.folder ?? '', old));
      const last = { at: new Date(), ok: true, message: `Отправлено: ${file}`, bytes };
      await this.coll.updateOne({ _id: t._id as never }, { $set: { last } });
      return { ok: true, message: last.message };
    } catch (e) {
      const last = { at: new Date(), ok: false, message: (e as Error).message, bytes };
      await this.coll.updateOne({ _id: t._id as never }, { $set: { last } });
      this.log.warn(`копия в «${t.name}» не ушла: ${last.message}`);
      return { ok: false, message: last.message };
    }
  }

  /** Раз в минуту: наступило время и сегодня ещё не отправляли — отправить. */
  private async tick() {
    try {
      const s = await this.settings();
      const now = new Date(); const hm = now.toTimeString().slice(0, 5); const today = now.toISOString().slice(0, 10);
      if (hm !== s.time || s.lastAuto === today || !s.password) return;
      await this.coll.updateOne({ _id: 'settings' as never }, { $set: { lastAuto: today } }, { upsert: true });
      await this.runAll();
    } catch (e) { this.log.warn(`расписание копий: ${(e as Error).message}`); }
  }

  private oid(id: string) { if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Цель не найдена'); return new Types.ObjectId(id); }
  private async target(id: string) { const t = (await this.coll.findOne({ _id: this.oid(id) as never })) as unknown as Target | null; if (!t) throw new NotFoundException('Цель не найдена'); return t; }
}
