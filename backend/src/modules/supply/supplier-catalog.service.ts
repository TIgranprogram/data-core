import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import * as ExcelJS from 'exceljs';
import { Connection, Types } from 'mongoose';
import { oid, oids } from '../../common/list-query';
import { normSearch } from '../../common/text/search-norm';
import { SupplierAliases } from './supplier-aliases';
import {
  CatRow, ExistingItem, MAX_IMPORT_ROWS, RowStatus, TEMPLATE_COLUMNS, classifyRow, itemKey, normColor, parseDate, parseSheet,
} from './supplier-catalog-import';
import { CatalogItemDto, CatalogItemPatchDto } from './dto-catalog';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Source = 'excel' | 'request' | 'stock' | 'manual';

/** Данные для записи одной позиции каталога. */
export interface UpsertData {
  supplierId: Types.ObjectId; article: string; color: string; name: string; unit?: string; price?: number | null;
  priceDate?: Date | null; optGroup?: string; note?: string; materialId?: Types.ObjectId | null; categoryId?: Types.ObjectId | null; source: Source;
}

const STALE_DAYS = 180;
const DAY = 86400000;

/** Каталог поставщиков v2: список, счётчики, правка, импорт/экспорт Excel. Таблица одна — `supplieritems`. */
@Injectable()
export class SupplierCatalogService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private get items() { return this.conn.db!.collection('supplieritems'); }
  private coll(n: string) { return this.conn.db!.collection(n); }

  // ───────── список и счётчики ─────────

  private filter(q: Record<string, string | undefined>): Doc {
    const f: Doc = { deletedAt: null };
    const sup = oids(q.supplierId), cat = oids(q.categoryId), mat = oids(q.materialId);
    if (sup.length) f.supplierId = { $in: sup };
    if (cat.length) f.categoryId = { $in: cat };
    if (mat.length) f.materialId = { $in: mat };
    if (q.unmatched === '1') f.materialId = null;
    if (q.noPrice === '1') f.priceHint = null;
    if (q.stale === '1') f.$and = [{ priceHint: { $ne: null } }, { $or: [{ priceDate: null }, { priceDate: { $lt: new Date(Date.now() - STALE_DAYS * DAY) } }] }];
    const s = String(q.search ?? '').trim();
    if (s) {
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$or = [{ name: re }, { article: re }, { note: re }];
    }
    return f;
  }

  private async present(docs: Doc[]) {
    const orgIds = [...new Set(docs.map((d) => String(d.supplierId)))].filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
    const matIds = [...new Set(docs.map((d) => d.materialId && String(d.materialId)).filter(Boolean))].map((s) => new Types.ObjectId(s as string));
    const [orgs, mats] = await Promise.all([
      orgIds.length ? this.coll('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1, inn: 1 } }).toArray() : [],
      matIds.length ? this.coll('materials').find({ _id: { $in: matIds } }, { projection: { name: 1, article: 1, stockQty: 1 } }).toArray() : [],
    ]);
    const on = new Map(orgs.map((o) => [String(o._id), o]));
    const mn = new Map(mats.map((m) => [String(m._id), m]));
    return docs.map((d) => {
      const o = on.get(String(d.supplierId)), m = d.materialId ? mn.get(String(d.materialId)) : undefined;
      const last = Array.isArray(d.priceHistory) && d.priceHistory.length ? d.priceHistory[d.priceHistory.length - 1] : null;
      const priceDate = d.priceDate ?? last?.date ?? null;
      return {
        id: String(d._id), supplierId: String(d.supplierId), supplierName: o ? String(o.shortName || o.name) : '', supplierInn: o?.inn ? String(o.inn) : '',
        article: String(d.article ?? ''), name: String(d.name ?? ''), color: d.color ? String(d.color) : '', unit: d.unit ? String(d.unit) : '',
        priceHint: typeof d.priceHint === 'number' ? d.priceHint : null,
        priceDate: priceDate instanceof Date ? priceDate.toISOString() : null,
        optGroup: d.optGroup ? String(d.optGroup) : '', note: d.note ? String(d.note) : '', source: d.source ?? 'excel',
        materialId: d.materialId ? String(d.materialId) : null, materialName: m ? String(m.name) : '', materialArticle: m ? String(m.article ?? '') : '',
        stockQty: m && typeof m.stockQty === 'number' ? m.stockQty : null,
        categoryId: d.categoryId ? String(d.categoryId) : null, inStock: d.inStock ?? null, photoUrl: d.photoUrl ?? '',
        priceHistory: (d.priceHistory ?? []).map((h: Doc) => ({ price: h.price, date: h.date instanceof Date ? h.date.toISOString() : null, source: h.source })),
        updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : null,
      };
    });
  }

  async list(q: Record<string, string | undefined>) {
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(String(q.limit ?? '100'), 10) || 100));
    const f = this.filter(q);
    const [docs, total] = await Promise.all([
      this.items.find(f).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.items.countDocuments(f),
    ]);
    return { items: await this.present(docs), total, page, limit };
  }

  /** Левая панель: «Все», поставщики с числом, категории с числом, «Не сопоставлено», «Без цены / старая цена». */
  async counts() {
    const base = { deletedAt: null };
    const stale = new Date(Date.now() - STALE_DAYS * DAY);
    const [bySup, byCat, all, unmatched, noPrice, old] = await Promise.all([
      this.items.aggregate([{ $match: base }, { $group: { _id: '$supplierId', n: { $sum: 1 } } }]).toArray(),
      this.items.aggregate([{ $match: { ...base, categoryId: { $ne: null } } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray(),
      this.items.countDocuments(base),
      this.items.countDocuments({ ...base, materialId: null }),
      this.items.countDocuments({ ...base, priceHint: null }),
      this.items.countDocuments({ ...base, priceHint: { $ne: null }, $or: [{ priceDate: null }, { priceDate: { $lt: stale } }] }),
    ]);
    const [orgs, cats] = await Promise.all([
      bySup.length ? this.coll('organizations').find({ _id: { $in: bySup.map((x) => x._id) } }, { projection: { name: 1, shortName: 1 } }).toArray() : [],
      byCat.length ? this.coll('categories').find({ _id: { $in: byCat.map((x) => x._id) } }, { projection: { name: 1 } }).toArray() : [],
    ]);
    const on = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const cn = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
    return {
      all, unmatched, noPrice, stale: old,
      suppliers: bySup.map((x) => ({ id: String(x._id), name: on.get(String(x._id)) ?? '(поставщик удалён)', count: x.n })).sort(byName),
      categories: byCat.map((x) => ({ id: String(x._id), name: cn.get(String(x._id)) ?? '(категория удалена)', count: x.n })).sort(byName),
    };
  }

  // ───────── запись ─────────

  /** Записать одну позицию. Для stock/request существующую не перетираем — только дополняем пустое. */
  async upsertOne(ex: Doc | undefined, d: UpsertData): Promise<'created' | 'updated' | 'same'> {
    const now = new Date();
    const date = d.priceDate ?? now;
    const hasPrice = typeof d.price === 'number';
    if (!ex) {
      await this.items.insertOne({
        // vendorArticle — старый уникальный индекс (supplierId, vendorArticle, organizationId) на проде: без него вторая позиция поставщика даёт дубль null
        supplierId: d.supplierId, article: d.article, vendorArticle: d.article, name: d.name, ...(d.color ? { color: d.color } : {}),
        ...(d.unit ? { unit: d.unit } : {}), ...(d.optGroup ? { optGroup: d.optGroup } : {}), ...(d.note ? { note: d.note } : {}),
        ...(d.materialId ? { materialId: d.materialId } : {}), ...(d.categoryId ? { categoryId: d.categoryId } : {}),
        ...(hasPrice ? { priceHint: d.price, priceDate: date } : {}),
        source: d.source, priceHistory: hasPrice ? [{ price: d.price, date, source: d.source }] : [],
        deletedAt: null, createdAt: now, updatedAt: now,
      });
      return 'created';
    }
    const fillOnly = d.source === 'stock' || d.source === 'request';
    const set: Doc = {};
    const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '' && (!fillOnly || ex[k] === undefined || ex[k] === null || ex[k] === '') && String(ex[k] ?? '') !== String(v)) set[k] = v; };
    if (!fillOnly) put('name', d.name);
    put('unit', d.unit); put('optGroup', d.optGroup); put('note', d.note); put('materialId', d.materialId); put('categoryId', d.categoryId);
    const push: Doc = {};
    if (hasPrice && (!fillOnly || ex.priceHint == null) && d.price !== ex.priceHint) {
      set.priceHint = d.price; set.priceDate = date;
      push.priceHistory = { price: d.price, date, source: d.source };
    }
    if (ex.deletedAt) set.deletedAt = null;
    if (!Object.keys(set).length) return 'same';
    if (!fillOnly) set.source = d.source;
    set.updatedAt = now;
    await this.items.updateOne({ _id: ex._id }, { $set: set, ...(push.priceHistory ? { $push: push } : {}) });
    return 'updated';
  }

  private async materialsBy(ids: Types.ObjectId[]) {
    const mats = ids.length ? await this.coll('materials').find({ _id: { $in: ids } }, { projection: { name: 1, unit: 1, categoryId: 1, article: 1 } }).toArray() : [];
    return new Map(mats.map((m) => [String(m._id), m]));
  }

  /** Массовая запись (скрипт catalog-from-stock): ключ supplierId+article+color, без артикула — `manual:<materialId>`. */
  async bulk(items: CatalogItemDto[]) {
    const res = { created: 0, updated: 0, same: 0, errors: [] as string[] };
    const mats = await this.materialsBy(items.map((i) => i.materialId).filter(Boolean).map((i) => new Types.ObjectId(i)));
    for (const [i, it] of items.entries()) {
      const article = (it.article ?? '').trim() || (it.materialId ? `manual:${it.materialId}` : '');
      if (!article) { res.errors.push(`#${i + 1}: нет артикула и материала`); continue; }
      if (!Types.ObjectId.isValid(String(it.supplierId ?? ''))) { res.errors.push(`#${i + 1}: неверный поставщик «${it.supplierId}»`); continue; }
      const color = normColor(it.color);
      const m = it.materialId ? mats.get(it.materialId) : undefined;
      const supplierId = new Types.ObjectId(it.supplierId);
      try {
      const ex = await this.items.findOne({ supplierId, article, color: color || { $in: [null, ''] } as any }); // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await this.upsertOne(ex ?? undefined, {
        supplierId, article, color, name: it.name, unit: it.unit || (m?.unit as string), price: it.price ?? null, priceDate: parseDate(it.priceDate),
        note: it.note, materialId: m ? m._id : null, categoryId: m?.categoryId ?? null, source: it.source ?? 'manual',
      });
      res[r]++;
      } catch (e) { res.errors.push(`#${i + 1} ${article}: ${(e as Error).message}`); } // строка с ошибкой не роняет весь пакет
    }
    return res;
  }

  /** Правка позиции из панели. */
  async patch(id: string, dto: CatalogItemPatchDto) {
    const ex = await this.items.findOne({ _id: oid(id), deletedAt: null });
    if (!ex) throw new NotFoundException('Позиция каталога не найдена');
    const set: Doc = { updatedAt: new Date() };
    const unset: Doc = {};
    for (const k of ['name', 'unit', 'color', 'note', 'optGroup', 'inStock'] as const) if (dto[k] !== undefined) set[k] = dto[k];
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Название не может быть пустым');
    if (dto.materialId !== undefined) {
      if (dto.materialId === null) { unset.materialId = ''; unset.categoryId = ''; }
      else {
        const m = (await this.materialsBy([oid(dto.materialId, 'материала')])).get(dto.materialId);
        if (!m) throw new BadRequestException('Материал не найден');
        set.materialId = m._id;
        if (m.categoryId) set.categoryId = m.categoryId;
        if (!ex.unit && m.unit) set.unit = m.unit;
      }
    }
    const upd: Doc = { $set: set };
    if (Object.keys(unset).length) upd.$unset = unset;
    if (dto.price !== undefined && dto.price !== ex.priceHint) {
      const now = new Date();
      set.priceHint = dto.price; set.priceDate = now;
      upd.$push = { priceHistory: { price: dto.price, date: now, source: 'manual' } };
    }
    try { await this.items.updateOne({ _id: ex._id }, upd); }
    catch (e) { if ((e as { code?: number }).code === 11000) throw new BadRequestException('Такая позиция (артикул + цвет) у поставщика уже есть'); throw e; }
    return (await this.present([(await this.items.findOne({ _id: ex._id }))!]))[0];
  }

  async remove(id: string) {
    const r = await this.items.updateOne({ _id: oid(id), deletedAt: null }, { $set: { deletedAt: new Date(), updatedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Позиция каталога не найдена');
    return { ok: true };
  }

  // ───────── Excel ─────────

  private async readMatrix(buffer: Buffer): Promise<unknown[][]> {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw new BadRequestException('Не удалось прочитать файл: нужен .xlsx'); }
    const ws = wb.getWorksheet('Прайс') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel: лист не найден');
    const m: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const line: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { line[c - 1] = cell.value; });
      m[n - 1] = line;
    });
    return m;
  }

  /** Разбор + сопоставление + статусы (общий для предпросмотра и записи). */
  private async plan(buffer: Buffer, supplierId?: string) {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const { rows, headerRow } = parseSheet(await this.readMatrix(buffer));
    if (headerRow < 0) throw new BadRequestException('Excel: не найдена колонка «Артикул поставщика». Скачайте шаблон.');
    if (!rows.length) throw new BadRequestException('Excel: нет строк для импорта');
    if (rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Excel: больше ${MAX_IMPORT_ROWS} строк — разделите файл`);
    const chosen = supplierId ? oid(supplierId, 'поставщика') : null;

    const orgs = await this.coll('organizations').find({ deletedAt: null }, { projection: { name: 1, shortName: 1, inn: 1 } }).toArray();
    const byInn = new Map(orgs.filter((o) => o.inn).map((o) => [String(o.inn).replace(/\s/g, ''), o]));
    const byName = new Map<string, Doc>();
    for (const o of orgs) for (const n of [o.name, o.shortName]) if (n) byName.set(normSearch(String(n)), o);
    const orgById = new Map(orgs.map((o) => [String(o._id), o]));
    const chosenOrg = chosen ? orgById.get(String(chosen)) : undefined;
    if (chosen && !chosenOrg) throw new BadRequestException('Поставщик не найден');

    // поставщик строки: ИНН → название в файле → выбранный в окне
    const sup = new Map<CatRow, Doc | undefined>();
    for (const r of rows) {
      if (r.errors.length && !r.article) { sup.set(r, undefined); continue; }
      let o: Doc | undefined;
      if (r.inn) { o = byInn.get(r.inn); if (!o) r.errors.push('неизвестный ИНН поставщика'); }
      else if (r.supplier) { o = byName.get(normSearch(r.supplier)); if (!o) r.errors.push('неизвестный поставщик «' + r.supplier + '»'); }
      else { o = chosenOrg; if (!o) r.errors.push('не указан поставщик'); }
      sup.set(r, o);
    }

    // существующие позиции нужных поставщиков (с удалёнными — ключ уникален)
    const supIds = [...new Set([...sup.values()].filter(Boolean).map((o) => String(o!._id)))].map((s) => new Types.ObjectId(s));
    const existing = supIds.length ? await this.items.find({ supplierId: { $in: supIds } }).toArray() : [];
    const exMap = new Map(existing.map((e) => [`${e.supplierId}|${itemKey(e.article, e.color)}`, e]));

    // наш материал: «Наш артикул», иначе алиасы поставщика
    const arts = [...new Set(rows.map((r) => r.ourArticle).filter(Boolean))];
    const mats = arts.length ? await this.coll('materials').find({ article: { $in: arts }, deletedAt: null }, { projection: { name: 1, unit: 1, categoryId: 1, article: 1 } }).toArray() : [];
    const matByArt = new Map(mats.map((m) => [String(m.article), m]));
    const aliases = new SupplierAliases(this.conn);
    const out: Array<{ row: CatRow; org?: Doc; ex?: Doc; mat?: Doc; status: RowStatus }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const org = sup.get(r);
      let mat = r.ourArticle ? matByArt.get(r.ourArticle) : undefined;
      if (r.ourArticle && !mat) r.errors.push('«Наш артикул» не найден в складе');
      if (!mat && org && !r.errors.length) {
        const hit = (await aliases.match(String(org.name), [{ name: r.name, article: r.article }]))[0];
        if (hit?.article) mat = await this.coll('materials').findOne({ article: hit.article, deletedAt: null }, { projection: { name: 1, unit: 1, categoryId: 1, article: 1 } }) ?? undefined;
      }
      const ex = org ? exMap.get(`${org._id}|${itemKey(r.article, r.color)}`) : undefined;
      if (org && !r.errors.length) {
        const k = `${org._id}|${itemKey(r.article, r.color)}`;
        if (seen.has(k)) r.errors.push('повтор артикула и цвета в файле');
        seen.add(k);
      }
      out.push({ row: r, org, ex, mat, status: classifyRow(r, ex && ({ ...ex, materialId: ex.materialId ? String(ex.materialId) : null } as ExistingItem), mat ? String(mat._id) : null) });
    }
    return { hash, out };
  }

  private async duplicateOf(hash: string) {
    return !!(await this.coll('catalog_imports').findOne({ hash }));
  }

  /** Предпросмотр: ничего не пишет. */
  async preview(buffer: Buffer, supplierId?: string) {
    const { hash, out } = await this.plan(buffer, supplierId);
    const counts = { total: out.length, new: 0, price: 0, update: 0, same: 0, error: 0 };
    for (const o of out) counts[o.status]++;
    return {
      hash, duplicate: await this.duplicateOf(hash), counts,
      rows: out.map(({ row, org, ex, mat, status }) => ({
        rowNum: row.rowNum, status, errors: row.errors, supplierName: org ? String(org.shortName || org.name) : '',
        article: row.article, name: row.name, color: row.color, unit: row.unit, price: row.price, oldPrice: typeof ex?.priceHint === 'number' ? ex.priceHint : null,
        priceDate: row.priceDate ? row.priceDate.toISOString() : null, optGroup: row.optGroup, note: row.note,
        ourArticle: row.ourArticle, materialId: mat ? String(mat._id) : null, materialName: mat ? String(mat.name) : '',
      })),
    };
  }

  /** Запись: строки с ошибками пропускаются, остальные применяются; изменение цены — в историю. */
  async apply(buffer: Buffer, supplierId: string | undefined, userId?: string) {
    const { hash, out } = await this.plan(buffer, supplierId);
    const res = { hash, created: 0, updated: 0, same: 0, errors: 0, errorRows: [] as Array<{ rowNum: number; article: string; errors: string[] }> };
    for (const { row, org, ex, mat, status } of out) {
      if (status === 'error') { res.errors++; res.errorRows.push({ rowNum: row.rowNum, article: row.article, errors: row.errors }); continue; }
      if (status === 'same') { res.same++; continue; }
      const r = await this.upsertOne(ex, {
        supplierId: org!._id, article: row.article, color: row.color, name: row.name, unit: row.unit, price: row.price,
        priceDate: row.priceDate, optGroup: row.optGroup, note: row.note, materialId: mat?._id ?? null, categoryId: mat?.categoryId ?? null, source: 'excel',
      });
      res[r === 'created' ? 'created' : r === 'updated' ? 'updated' : 'same']++;
    }
    const { errorRows: _skip, ...stat } = res; // eslint-disable-line @typescript-eslint/no-unused-vars
    await this.coll('catalog_imports').insertOne({ ...stat, at: new Date(), userId: userId ? new Types.ObjectId(userId) : null, supplierId: supplierId ? new Types.ObjectId(supplierId) : null });
    return res;
  }

  private async book(title: string, rows: unknown[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Прайс');
    ws.addRow(title.split('|'));
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    TEMPLATE_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    return { wb, ws };
  }

  /** Пустой шаблон: лист «Прайс» с примером и лист «Инструкция». */
  async template(): Promise<Buffer> {
    const { wb } = await this.book(TEMPLATE_COLUMNS.map((c) => c.title).join('|'), [['AB-100', 'Труба 40х40 стальная', 'серый', 'м', 120.5, '01.10.2026', 'Металл', '', '', 'пример — удалите строку']]);
    const ins = wb.addWorksheet('Инструкция');
    ins.getColumn(1).width = 110;
    [
      'Колонки со звёздочкой (*) обязательны: «Артикул поставщика» и «Название у поставщика».',
      'Поставщика выберите в окне загрузки. Для общего файла добавьте колонку «ИНН поставщика» (или «Поставщик») — она главнее выбора.',
      'Позиция узнаётся по поставщику, артикулу и цвету. Та же позиция в новом файле обновляется, а не дублируется.',
      'Изменилась цена — старая остаётся в истории цен. Позиции, которых нет в файле, не удаляются.',
      '«Наш артикул» связывает позицию с материалом склада. Пусто — найдём по запомненным названиям поставщика, иначе останется «не сопоставлено».',
      'Дата цены: ДД.ММ.ГГГГ. Цена: число, можно «640,00 р.». Не больше 5000 строк в файле.',
      'Строки с ошибками в предпросмотре пропускаются, остальные загружаются.',
    ].forEach((t) => ins.addRow([t]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Экспорт по текущему фильтру: колонки шаблона + «Остаток», «ИНН поставщика», «Поставщик» — файл можно исправить и залить обратно. */
  async export(q: Record<string, string | undefined>): Promise<Buffer> {
    const docs = await this.items.find(this.filter(q)).sort({ supplierId: 1, name: 1 }).limit(20000).toArray();
    const view = await this.present(docs);
    const { wb, ws } = await this.book([...TEMPLATE_COLUMNS.map((c) => c.title), 'Остаток', 'ИНН поставщика', 'Поставщик'].join('|'), view.map((v) => [
      v.article, v.name, v.color, v.unit, v.priceHint ?? '', v.priceDate ? v.priceDate.slice(0, 10).split('-').reverse().join('.') : '',
      v.optGroup, v.materialArticle, v.materialName, v.note, v.stockQty ?? '', v.supplierInn, v.supplierName,
    ]));
    ws.getColumn(11).width = 10; ws.getColumn(12).width = 16; ws.getColumn(13).width = 28;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
