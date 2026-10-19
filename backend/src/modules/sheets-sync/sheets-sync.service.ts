import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { mongoCollectionName } from '../app-data/app-data.validation';
import { GoogleServiceAuth, type ServiceAccountKey } from './google-auth';
import { SHEET_MAPS, sheetToRows, type SheetMap } from './sheets-sync.mapping';
import { SheetCatalog } from './sheet-catalog';
import { PhotosService } from '../photos/photos.service';
import { SheetTargets } from './sheets-sync.targets';
import { StockService } from '../stock/stock.service';

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
  /** Какие листы брать из этой таблицы. Лист, уже взятый из другой таблицы (копия через IMPORTRANGE), не берётся — иначе дубли. */
  sheets?: string[];
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

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly stock: StockService,
    private readonly photos: PhotosService,
  ) {
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
    const names = (meta.sheets ?? []).map((s) => s.properties?.title ?? '');
    const claimed = new Set((await this.sources().find({}).toArray()).flatMap((s) => s.sheets ?? []));
    const known = SHEET_MAPS.filter((m) => names.includes(m.sheet)).map((m) => m.sheet);
    const sheets = known.filter((n) => !claimed.has(n));
    const doc: SourceDoc = { _id: new Types.ObjectId(), spreadsheetId, title: meta.properties?.title ?? spreadsheetId, addedAt: new Date(), lastRunAt: null, lastResult: [], lastError: null, sheets };
    await this.sources().insertOne(doc);
    return { id: String(doc._id), ...doc, _id: String(doc._id), sheetsFound: sheets, sheetsSkipped: known.filter((n) => claimed.has(n)) };
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
      // Листы источника: закреплённые за ним при подключении + новые в сопоставлении (напр. «Заказы», 2026-10-19),
      // если их не забрала другая подключённая таблица (копии листов через IMPORTRANGE не берём дважды).
      const claimedElsewhere = new Set((await this.sources().find({ _id: { $ne: src._id } }).toArray()).flatMap((s) => s.sheets ?? []));
      const maps = SHEET_MAPS.filter((m) => names.includes(m.sheet) && (m.target === 'catalog' || !src.sheets || src.sheets.includes(m.sheet) || !claimedElsewhere.has(m.sheet)));
      const ownSheets = maps.filter((m) => m.target !== 'catalog').map((m) => m.sheet);
      if (src.sheets && ownSheets.some((s) => !src.sheets!.includes(s))) {
        await this.sources().updateOne({ _id: src._id }, { $set: { sheets: [...new Set([...src.sheets, ...ownSheets])] } });
      }
      if (!maps.length) lines.push(`нет листов ${SHEET_MAPS.map((m) => `«${m.sheet}»`).join(', ')}`);
      const catalog = maps.find((m) => m.target === 'catalog');
      const dataMaps = maps.filter((m) => m.target !== 'catalog');
      if (dataMaps.length) {
        const q = dataMaps.map((m) => `ranges=${encodeURIComponent(`'${m.sheet.replace(/'/g, "''")}'`)}`).join('&');
        const data = await this.google<{ valueRanges?: { values?: unknown[][] }[] }>(
          `${SHEETS_API}/${src.spreadsheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
        );
        const targets = new SheetTargets(this.connection, this.stock);
        for (const [i, map] of dataMaps.entries()) {
          try {
            lines.push(await this.syncSheet(src.spreadsheetId, map, data.valueRanges?.[i]?.values ?? [], targets));
          } catch (e) {
            lines.push(`${map.sheet}: ❌ ${(e as Error).message}`);
          }
        }
      }
      if (catalog) {
        try {
          const sheet = `'${catalog.sheet.replace(/'/g, "''")}'`;
          const data = await this.google<{ values?: unknown[][] }>(`${SHEETS_API}/${src.spreadsheetId}/values/${encodeURIComponent(sheet)}?valueRenderOption=FORMULA`);
          lines.push(await new SheetCatalog(this.connection, this.photos, this.fetchFn).sync(data.values ?? []));
        } catch (e) {
          lines.push(`${catalog.sheet}: ❌ ${(e as Error).message}`);
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

  /** Один лист → его коллекция. Возвращает строку итога. */
  async syncSheet(spreadsheetId: string, map: SheetMap, values: unknown[][], targets = new SheetTargets(this.connection, this.stock)): Promise<string> {
    return map.target === 'app' ? this.syncAppSheet(spreadsheetId, map, values) : this.syncCrmSheet(spreadsheetId, map, values, targets);
  }

  /**
   * Лист → ОБЩАЯ коллекция CRM (supplyrequests / materials+storageitems / stockmovements).
   * Строка узнаётся по sheetSource+sheetKey; неизменённая (syncHash) не трогается; поля CRM, которыми
   * лист не управляет (фото, связи, заметки из CRM), не затираются.
   */
  private async syncCrmSheet(spreadsheetId: string, map: SheetMap, values: unknown[][], targets: SheetTargets): Promise<string> {
    const { rows } = sheetToRows(values, map);
    const ad = targets.get(map.target);
    const coll = this.db().collection<Raw>(ad.collection);
    const sheetSource = `${spreadsheetId}/${map.sheet}`;
    // Хозяин данных — приложение (PRODUCT «Решения»): изменённое или удалённое в приложении (editedInApp)
    // таблица больше не трогает. Удалённое самой синхронизацией (строку убрали из листа) — вернётся, если строка вернулась.
    const all = await coll.find({ sheetSource }).toArray();
    const existing = all.filter((d) => d.deletedAt == null);
    const byKey = new Map(all.map((d) => [String(d.sheetKey), d]));
    const seen = new Set<string>();
    let created = 0, updated = 0, adopted = 0, skipped = 0, linked = 0, kept = 0;

    for (const row of rows) {
      let cur: Raw | null | undefined = byKey.get(row.key);
      if (cur && cur.editedInApp) {
        seen.add(String(cur._id));
        if (cur.syncHash !== row.hash) kept++;
        continue;
      }
      const revive = !!cur && cur.deletedAt != null;
      if (cur && !revive && cur.syncHash === row.hash) {
        seen.add(String(cur._id));
        const link = ad.relink ? await ad.relink(cur, row.doc) : null;
        if (link) { await coll.updateOne({ _id: cur._id }, { $set: { ...link, updatedAt: new Date() } }); linked++; }
        continue;
      }
      const fields = await ad.toFields(row.doc);
      if (map.target === 'movements' && !fields.materialId) { skipped++; if (cur) seen.add(String(cur._id)); continue; }
      let isAdopted = false;
      if (!cur && ad.adopt) { cur = (await ad.adopt(row.doc, fields)) as Raw | null; isAdopted = !!cur; }
      const now = new Date();
      const set: Record<string, unknown> = { sheetSource, sheetKey: row.key, syncHash: row.hash, updatedAt: now, ...(revive ? { deletedAt: null } : {}) };
      const unset: Record<string, ''> = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) set[k] = v;
      let id: Types.ObjectId;
      if (!cur) {
        id = new Types.ObjectId();
        await coll.insertOne({ ...(ad.onCreate ? await ad.onCreate(fields) : {}), ...set, _id: id, source: 'google-sheets', createdAt: now, deletedAt: null } as Raw);
        created++;
      } else {
        id = cur._id;
        for (const f of ad.managedFields) if (fields[f] === undefined && f in cur) unset[f] = '';
        await coll.updateOne({ _id: id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
        if (isAdopted) adopted++; else updated++;
      }
      seen.add(String(id));
      if (ad.afterWrite) await ad.afterWrite(id, row.doc);
    }

    const gone = existing.filter((d) => !seen.has(String(d._id)) && !d.editedInApp);
    let deleted = 0, note = '';
    if (gone.length && !ad.allowDelete) {
      note = `, нет в таблице ${gone.length} (не удаляются)`;
    } else if (gone.length && gone.length > Math.max(3, existing.length * DELETE_GUARD_RATIO)) {
      note = ` ⚠️ удаление ${gone.length} записей пропущено (слишком много — проверьте лист)`;
    } else if (gone.length) {
      await coll.updateMany({ _id: { $in: gone.map((d) => d._id) } }, { $set: { deletedAt: new Date(), updatedAt: new Date() } });
      deleted = gone.length;
    }
    return `${map.sheet}: строк ${rows.length}, новых ${created}, изменено ${updated}` +
      (adopted ? `, связано с существующими ${adopted}` : '') + (skipped ? `, без позиции на складе ${skipped}` : '') + (linked ? `, связано с позициями склада ${linked}` : '') + (kept ? `, не тронуто (изменено/удалено в приложении) ${kept}` : '') +
      (ad.allowDelete ? `, удалено ${deleted}` : '') + note;
  }

  /** Лист без места в CRM → app_<app>_<collection> (хранилище приложений). */
  private async syncAppSheet(spreadsheetId: string, map: SheetMap, values: unknown[][]): Promise<string> {
    const { rows, sheetFields } = sheetToRows(values, map);
    const coll = this.db().collection<Raw>(mongoCollectionName(map.app, map.collection));
    const sheetSource = `${spreadsheetId}/${map.sheet}`;
    const now = new Date();

    const existing = await coll.find({ sheetSource, deletedAt: null }).toArray();
    const byKey = new Map(existing.map((d) => [String(d.sheetKey), d]));

    type BulkOp = Parameters<typeof coll.bulkWrite>[0] extends readonly (infer T)[] ? T : never;
    const ops: BulkOp[] = [];
    const seen = new Set<string>();
    let created = 0, updated = 0;
    for (const row of rows) {
      const cur = byKey.get(row.key);
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

    return `${map.sheet}: строк ${rows.length}, новых ${created}, изменено ${updated}, удалено ${deleted}${guard}`;
  }
}
