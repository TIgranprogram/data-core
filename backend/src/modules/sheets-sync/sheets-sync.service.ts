import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { mongoCollectionName } from '../app-data/app-data.validation';
import { GoogleServiceAuth, type ServiceAccountKey } from './google-auth';
import { SHEET_MAPS, normName, sheetToRows, type SheetMap } from './sheets-sync.mapping';

/** Коллекция подключённых таблиц (источников). */
export const SOURCES_COLLECTION = 'sheets_sync_sources';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
/** Не удалять, если из листа «пропало» больше 20% строк (лист очистили по ошибке). */
const DELETE_GUARD_RATIO = 0.2;

interface SourceDoc {
  _id: Types.ObjectId;
  spreadsheetId: string;
  title: string;
  addedAt: Date;
  lastRunAt?: Date | null;
  lastResult?: string[];
  lastError?: string | null;
}

type Raw = Record<string, unknown> & { _id: Types.ObjectId };

/** ID таблицы из ссылки `https://docs.google.com/spreadsheets/d/<id>/edit…` или сам ID. */
export function parseSpreadsheetId(input: string): string | null {
  const s = String(input ?? '').trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

/**
 * Сервер сам читает Google-таблицы через сервисный аккаунт (только чтение) и раскладывает
 * листы «Снабжение», «Реестр счетов», «Склад», «Движение склада» в /api/apps/supply|warehouse.
 * Без дублей: строка узнаётся по ключу (`sheetSource` + `sheetKey`), меняется только изменённое
 * (`syncHash`), записи из приложения не трогаются. Запуск — раз в N минут и кнопкой в админке.
 */
@Injectable()
export class SheetsSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SheetsSyncService.name);
  private auth: GoogleServiceAuth | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly keyFile: string;
  readonly intervalMin: number;
  /** Подменяется в тестах. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  constructor(@InjectConnection() private readonly connection: Connection) {
    this.keyFile = process.env.GOOGLE_SA_FILE
      || [join(process.cwd(), 'secrets', 'google-sa.json'), join(process.cwd(), '..', 'secrets', 'google-sa.json')].find((p) => existsSync(p))
      || join(process.cwd(), 'secrets', 'google-sa.json');
    this.intervalMin = Number(process.env.SHEETS_SYNC_INTERVAL_MIN ?? 10);
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !(this.intervalMin > 0)) return;
    // Первый прогон через минуту после старта, дальше — по расписанию
    const tick = () => { void this.runAll().catch((e) => this.logger.warn(`sheets-sync: ${(e as Error).message}`)); };
    setTimeout(tick, 60_000).unref();
    this.timer = setInterval(tick, this.intervalMin * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private db() {
    const db = this.connection?.db;
    if (!db) throw new BadRequestException('MongoDB is not connected');
    return db;
  }

  private sources() {
    return this.db().collection<SourceDoc>(SOURCES_COLLECTION);
  }

  /** Ключ читается при каждом обращении, пока не найден: можно положить файл без перезапуска. */
  private getAuth(): GoogleServiceAuth | null {
    if (this.auth) return this.auth;
    if (!existsSync(this.keyFile)) return null;
    const key = JSON.parse(readFileSync(this.keyFile, 'utf8')) as ServiceAccountKey;
    if (!key.client_email || !key.private_key) throw new Error('файл ключа Google без client_email/private_key');
    this.auth = new GoogleServiceAuth(key, this.fetchFn);
    return this.auth;
  }

  private requireAuth(): GoogleServiceAuth {
    const auth = this.getAuth();
    if (!auth) throw new BadRequestException('Ключ Google не установлен на сервере (secrets/google-sa.json)');
    return auth;
  }

  private async google<T>(url: string): Promise<T> {
    const auth = this.requireAuth();
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await auth.token()}` } });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
    if (res.ok) return body;
    const msg = body.error?.message ?? String(res.status);
    if (/has not been used|is disabled/i.test(msg)) throw new Error('в Google Cloud не включён Google Sheets API');
    if (res.status === 403) throw new Error(`нет доступа — поделитесь таблицей с ${auth.email} (роль «Читатель»)`);
    if (res.status === 404) throw new Error('таблица не найдена — проверьте ссылку');
    throw new Error(`Google: ${msg}`);
  }

  async status() {
    let serviceEmail: string | null = null;
    let keyError: string | null = null;
    try { serviceEmail = this.getAuth()?.email ?? null; } catch (e) { keyError = (e as Error).message; }
    const items = await this.sources().find({}).sort({ addedAt: 1 }).toArray();
    return {
      configured: !!serviceEmail,
      serviceEmail,
      keyError,
      intervalMin: this.intervalMin,
      running: this.running,
      sheets: SHEET_MAPS.map((m) => ({ sheet: m.sheet, target: `${m.app}/${m.collection}`, headerRow: m.headerRow })),
      items: items.map((s) => ({ id: String(s._id), ...s, _id: String(s._id) })),
    };
  }

  async addSource(url: string) {
    const spreadsheetId = parseSpreadsheetId(url);
    if (!spreadsheetId) throw new BadRequestException('Не похоже на ссылку Google-таблицы');
    const exists = await this.sources().findOne({ spreadsheetId });
    if (exists) throw new BadRequestException(`Таблица уже подключена: «${exists.title}»`);
    let meta: { properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };
    try {
      meta = await this.google(`${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties.title`);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const doc: SourceDoc = { _id: new Types.ObjectId(), spreadsheetId, title: meta.properties?.title ?? spreadsheetId, addedAt: new Date(), lastRunAt: null, lastResult: [], lastError: null };
    await this.sources().insertOne(doc);
    const names = (meta.sheets ?? []).map((s) => s.properties?.title ?? '');
    const known = SHEET_MAPS.filter((m) => names.includes(m.sheet)).map((m) => m.sheet);
    return { id: String(doc._id), ...doc, _id: String(doc._id), sheetsFound: known };
  }

  async removeSource(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id');
    const res = await this.sources().deleteOne({ _id: new Types.ObjectId(id) });
    if (!res.deletedCount) throw new NotFoundException('Источник не найден');
    return { id, deleted: true };
  }

  /** Синхронизировать все подключённые таблицы. Параллельный запуск не стартует. */
  async runAll() {
    if (this.running) return { skipped: true, reason: 'синхронизация уже идёт' };
    if (!this.getAuth()) return { skipped: true, reason: 'ключ Google не установлен' };
    this.running = true;
    try {
      const results = [];
      for (const src of await this.sources().find({}).toArray()) results.push(await this.runSource(src));
      return { skipped: false, items: results };
    } finally {
      this.running = false;
    }
  }

  private async runSource(src: SourceDoc) {
    const lines: string[] = [];
    let error: string | null = null;
    try {
      const meta = await this.google<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>(
        `${SHEETS_API}/${src.spreadsheetId}?fields=properties.title,sheets.properties.title`,
      );
      const names = (meta.sheets ?? []).map((s) => s.properties?.title ?? '');
      const maps = SHEET_MAPS.filter((m) => names.includes(m.sheet));
      if (!maps.length) lines.push(`нет листов ${SHEET_MAPS.map((m) => `«${m.sheet}»`).join(', ')}`);
      if (maps.length) {
        const q = maps.map((m) => `ranges=${encodeURIComponent(`'${m.sheet.replace(/'/g, "''")}'`)}`).join('&');
        const data = await this.google<{ valueRanges?: { values?: unknown[][] }[] }>(
          `${SHEETS_API}/${src.spreadsheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
        );
        for (const [i, map] of maps.entries()) {
          try {
            lines.push(await this.syncSheet(src.spreadsheetId, map, data.valueRanges?.[i]?.values ?? []));
          } catch (e) {
            lines.push(`${map.sheet}: ❌ ${(e as Error).message}`);
          }
        }
      }
      await this.sources().updateOne({ _id: src._id }, { $set: { title: meta.properties?.title ?? src.title } });
    } catch (e) {
      error = (e as Error).message;
    }
    await this.sources().updateOne({ _id: src._id }, { $set: { lastRunAt: new Date(), lastResult: lines, lastError: error } });
    if (error) this.logger.warn(`sheets-sync «${src.title}»: ${error}`);
    else this.logger.log(`sheets-sync «${src.title}»: ${lines.join(' | ')}`);
    return { id: String(src._id), title: src.title, lines, error };
  }

  /** Один лист → коллекция app_<app>_<collection>. Возвращает строку итога. */
  async syncSheet(spreadsheetId: string, map: SheetMap, values: unknown[][]): Promise<string> {
    const { rows, sheetFields } = sheetToRows(values, map);
    const coll = this.db().collection<Raw>(mongoCollectionName(map.app, map.collection));
    const sheetSource = `${spreadsheetId}/${map.sheet}`;
    const now = new Date();

    const existing = await coll.find({ sheetSource, deletedAt: null }).toArray();
    const byKey = new Map(existing.map((d) => [String(d.sheetKey), d]));
    // Позиция склада, заведённая в приложении раньше, чем попала в таблицу, — та же позиция
    const orphans = new Map<string, Raw>();
    if (map.adoptByName) {
      const free = await coll.find({ deletedAt: null, sheetSource: { $exists: false } }).toArray();
      for (const d of free) if (d.name) orphans.set(normName(d.name), d);
    }

    type BulkOp = Parameters<typeof coll.bulkWrite>[0] extends readonly (infer T)[] ? T : never;
    const ops: BulkOp[] = [];
    const seen = new Set<string>();
    let created = 0, updated = 0, adopted = 0;
    for (const row of rows) {
      let cur = byKey.get(row.key);
      if (!cur && map.adoptByName) {
        cur = orphans.get(row.key);
        if (cur) { orphans.delete(row.key); adopted++; }
      }
      if (!cur) {
        ops.push({ insertOne: { document: {
          ...row.doc, _id: new Types.ObjectId(), uid: randomUUID(), source: 'google-sheets', sheetSource, sheetKey: row.key, syncHash: row.hash,
          createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, deletedAt: null,
        } as Raw } });
        created++;
        continue;
      }
      seen.add(String(cur._id));
      if (cur.syncHash === row.hash && cur.sheetSource === sheetSource) continue;
      // Очищенная в таблице ячейка → очистить в базе. Только поля листа: фото, связи и прочее из приложения не трогаем.
      const unset: Record<string, ''> = {};
      for (const f of sheetFields) if (!(f in row.doc) && f in cur) unset[f] = '';
      ops.push({ updateOne: { filter: { _id: cur._id }, update: {
        $set: { ...row.doc, sheetSource, sheetKey: row.key, syncHash: row.hash, updatedAt: now },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      } } });
      if (!byKey.has(row.key)) continue; // подхваченная запись уже посчитана в adopted
      updated++;
    }

    const gone = existing.filter((d) => !seen.has(String(d._id)));
    let deleted = 0, guard = '';
    if (gone.length && gone.length > Math.max(3, existing.length * DELETE_GUARD_RATIO)) {
      guard = ` ⚠️ удаление ${gone.length} записей пропущено (слишком много — проверьте лист)`;
    } else if (gone.length) {
      ops.push({ updateMany: { filter: { _id: { $in: gone.map((d) => d._id) } }, update: { $set: { deletedAt: now, updatedAt: now } } } });
      deleted = gone.length;
    }
    for (let i = 0; i < ops.length; i += 500) await coll.bulkWrite(ops.slice(i, i + 500), { ordered: false });

    return `${map.sheet}: строк ${rows.length}, новых ${created}, изменено ${updated}` +
      (adopted ? `, связано с приложением ${adopted}` : '') + `, удалено ${deleted}${guard}`;
  }
}
