import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid } from '../../common/list-query';
import { isUsedByCrm } from '../catalog/catalog-references';
import { CounterService } from '../counter/counter.service';
import { parseCatalog } from './catalog-rows';
import { productNameKey, shortProductName } from './order-product-name';

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const LIVE = { deletedAt: null };

/**
 * «Продукция» — витрина изделий компании и КП (TASKS БЗ-4) поверх общей коллекции CRM `products` (kind good, unit шт):
 * артикул = `sku`, раздел (Тип) → группа — категории `categories` type 'product' (родитель → ребёнок), цена — `listPrice`,
 * серия — `series` (поле только data-core, CRM его не читает). Загруженное из каталога — `status: draft`, пока нет цены.
 */
@Injectable()
export class ShowcaseService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly counter: CounterService) {}
  private get db() { return this.connection.db!; }

  private async photos(ids: Types.ObjectId[]) {
    const map = new Map<string, { id: string; url: string; thumb: string }>();
    if (!ids.length) return map;
    const [orig, thumbs] = await Promise.all([
      this.db.collection('photos').find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      this.db.collection('photos').find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const th = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
    for (const p of orig) map.set(String(p._id), { id: String(p._id), url: String(p.storageUrl), thumb: th.get(String(p._id)) ?? String(p.storageUrl) });
    return map;
  }

  private async present(docs: Doc[]) {
    const catIds = [...new Set(docs.map((d) => d.categoryId).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const cats = catIds.length ? await this.db.collection('categories').find({ _id: { $in: catIds } }, { projection: { name: 1, parentId: 1 } }).toArray() : [];
    const parents = await this.db.collection('categories').find({ _id: { $in: cats.map((c) => c.parentId).filter(Boolean) } }, { projection: { name: 1 } }).toArray();
    const cat = new Map(cats.map((c) => [String(c._id), c])); const par = new Map(parents.map((p) => [String(p._id), String(p.name)]));
    const ph = await this.photos(docs.flatMap((d) => ((d.photoIds as Types.ObjectId[]) ?? [])));
    return docs.map((d) => {
      const c = d.categoryId ? cat.get(String(d.categoryId)) : undefined;
      const pics = ((d.photoIds as Types.ObjectId[]) ?? []).map((p) => ph.get(String(p))).filter(Boolean);
      return { id: String(d._id), sku: String(d.sku ?? ''), name: String(d.name ?? d.sku ?? ''), series: (d.series as string) ?? null, description: (d.description as string) ?? null,
        price: Number(d.listPrice) > 0 ? Number(d.listPrice) : null, status: String(d.status ?? 'new'), groupId: c ? String(c._id) : null, group: c ? String(c.name) : null,
        type: c?.parentId ? par.get(String(c.parentId)) ?? null : null, photos: pics, photo: pics[0] ?? null, deletedAt: (d.deletedAt as Date) ?? null };
    });
  }

  async list(q: Record<string, unknown>) {
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const filter: Record<string, unknown> = { deletedAt: String(q.deleted) === '1' ? { $ne: null } : null };
    if (q.search) { const re = new RegExp(String(q.search).trim().split(/\s+/).map(escapeRe).join('.*'), 'i'); filter.$or = [{ name: re }, { sku: re }, { series: re }]; }
    if (q.groupId) {
      const g = oid(String(q.groupId), 'группы');
      const kids = await this.db.collection('categories').find({ parentId: g }, { projection: { _id: 1 } }).toArray();
      filter.categoryId = { $in: [g, ...kids.map((k) => k._id)] };
    }
    const sortKey = String(q.sort || 'name').replace(/^-/, ''); const dir = String(q.sort || '').startsWith('-') ? -1 : 1;
    const sortField = ({ name: 'name', sku: 'sku', price: 'listPrice', series: 'series', deletedAt: 'deletedAt' } as Record<string, string>)[sortKey] ?? 'name';
    const [docs, total] = await Promise.all([
      this.db.collection('products').find(filter).sort({ [sortField]: dir, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.db.collection('products').countDocuments(filter),
    ]);
    return { items: await this.present(docs as Doc[]), total, page, limit };
  }

  /** Разделы и группы с числом изделий — плитки витрины. */
  async groups() {
    const cats = await this.db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1 } }).sort({ name: 1 }).toArray();
    const counts = await this.db.collection('products').aggregate([{ $match: LIVE }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();
    const n = new Map(counts.map((c) => [String(c._id), c.n as number]));
    const byParent = new Map<string, number>();
    for (const c of cats) if (c.parentId) byParent.set(String(c.parentId), (byParent.get(String(c.parentId)) ?? 0) + (n.get(String(c._id)) ?? 0));
    return cats.map((c) => ({ id: String(c._id), name: String(c.name), parentId: c.parentId ? String(c.parentId) : null, count: (n.get(String(c._id)) ?? 0) + (byParent.get(String(c._id)) ?? 0) }))
      .filter((c) => c.count > 0);
  }

  async get(id: string) {
    const d = await this.db.collection('products').findOne({ _id: oid(id, 'изделия') });
    if (!d) throw new NotFoundException('Изделие не найдено');
    const item = (await this.present([d as Doc]))[0];
    return { ...item, orderLines: await this.orderLines(d as Doc) };
  }

  /** Где изделие в заказах: позиции со ссылкой productId или с тем же названием (без регистра), до 30 штук (БЗ-5). */
  private async orderLines(d: Doc) {
    const name = clean(d.name);
    const or: Record<string, unknown>[] = [{ productId: d._id }];
    if (name) or.push({ title: new RegExp('^\\s*' + escapeRe(name).replace(/\s+/g, '\\s+') + '\\s*$', 'i') });
    const lines = await this.db.collection('incomes').find({ ...LIVE, orderId: { $ne: null }, $or: or }).sort({ shipDate: -1 }).limit(30).toArray();
    return lines.map((l) => ({ id: String(l._id), orderId: String(l.orderId), orderNo: l.orderNo ?? null, customer: l.customer ?? null, qty: l.qty ?? null, color: l.color ?? null, shipDate: l.shipDate ?? null, linked: !!l.productId }));
  }

  /** Категория type product по названию (с родителем) — найти или завести (slug и skuPrefix уникальны в общей схеме). */
  private async category(name: string | null, parentId: Types.ObjectId | null) {
    const n = clean(name);
    if (!n) return parentId;
    const found = await this.db.collection('categories').findOne({ type: 'product', deletedAt: null, parentId: parentId ?? null, name: new RegExp(`^\\s*${escapeRe(n)}\\s*$`, 'i') });
    if (found) return found._id as Types.ObjectId;
    const h = createHash('md5').update(`${parentId ?? ''}/${n.toLowerCase()}`).digest('hex').slice(0, 8);
    const { insertedId } = await this.db.collection('categories').insertOne({ name: n, slug: `product-${h}`, type: 'product', parentId: parentId ?? null, skuPrefix: `PR${h.toUpperCase()}`, sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
    return insertedId;
  }

  private async fields(dto: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) { const v = clean(dto.name); if (!v) throw new BadRequestException('Наименование не может быть пустым'); set.name = v; }
    if (dto.series !== undefined) set.series = clean(dto.series) || null;
    if (dto.description !== undefined) set.description = String(dto.description ?? '').trim() || null;
    if (dto.price !== undefined) { const p = dto.price === null || dto.price === '' ? 0 : Number(String(dto.price).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(p) || p < 0) throw new BadRequestException('Цена — число'); set.listPrice = p; if (p > 0) set.status = 'active'; }
    if (dto.group !== undefined || dto.type !== undefined) set.categoryId = await this.category(dto.group as string, await this.category(dto.type as string, null));
    if (Array.isArray(dto.photoIds)) set.photoIds = (dto.photoIds as string[]).filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    return set;
  }

  async create(dto: Record<string, unknown>) {
    const sku = clean(dto.sku);
    if (!sku) throw new BadRequestException('Укажите артикул');
    if (await this.db.collection('products').findOne({ sku: new RegExp(`^\\s*${escapeRe(sku)}\\s*$`, 'i') })) throw new ConflictException(`Изделие с артикулом ${sku} уже есть`);
    const set = await this.fields({ ...dto, name: dto.name ?? sku });
    const now = new Date();
    const { insertedId } = await this.db.collection('products').insertOne({ sku, kind: 'good', unit: 'шт', status: 'draft', listPrice: 0, basePrice: 0, costPrice: 0, defaultMarkupPercent: 30, stockQty: 0,
      photoIds: [], mainPhotoId: null, productModuleIds: [], composition: [], isActive: true, deletedAt: null, hasPassport: false, hasDrawing: false, ...set, source: 'showcase', createdAt: now, updatedAt: now });
    return this.get(String(insertedId));
  }

  async update(id: string, dto: Record<string, unknown>) {
    const _id = oid(id, 'изделия');
    const set = await this.fields(dto);
    if (dto.sku !== undefined) {
      const sku = clean(dto.sku); if (!sku) throw new BadRequestException('Артикул не может быть пустым');
      if (await this.db.collection('products').findOne({ _id: { $ne: _id }, sku: new RegExp(`^\\s*${escapeRe(sku)}\\s*$`, 'i') })) throw new ConflictException(`Артикул ${sku} уже у другого изделия`);
      set.sku = sku;
    }
    if (set.photoIds) set.mainPhotoId = (set.photoIds as Types.ObjectId[])[0] ?? null;
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, { $set: { ...set, updatedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return this.get(id);
  }

  /** В корзину: изделие из заказов CRM / КП не удаляется (ссылки) — проверяем составы и заказы CRM. */
  async remove(id: string) {
    const _id = oid(id, 'изделия');
    const used = await this.db.collection('products').findOne({ deletedAt: null, 'composition.productId': _id }, { projection: { name: 1 } });
    if (used) throw new ConflictException(`Изделие входит в состав «${used.name}» — удалить нельзя`);
    if (await isUsedByCrm(this.connection, 'product', _id)) throw new ConflictException('На изделие ссылаются заказы / документы CRM — удалить нельзя');
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, { $set: { deletedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return { id, deleted: true };
  }

  async restore(id: string) {
    await this.db.collection('products').updateOne({ _id: oid(id, 'изделия') }, { $set: { deletedAt: null } });
    return this.get(id);
  }

  /**
   * Загрузка каталога (Excel / вставка): по артикулу — новое изделие или обновление названия, раздела/группы, серии
   * (цену — только если в файле есть, а у изделия нет). apply=false — только отчёт (что будет). Ничего не удаляет.
   */
  async import(text: string, apply: boolean) {
    const { rows, errors } = parseCatalog(text);
    const existing = await this.db.collection('products').find({ sku: { $in: rows.map((r) => r.sku) } }, { projection: { sku: 1, name: 1, series: 1, listPrice: 1, deletedAt: 1 } }).toArray();
    const by = new Map(existing.map((e) => [String(e.sku).toLowerCase(), e]));
    const plan = rows.map((r) => {
      const e = by.get(r.sku.toLowerCase());
      const action = !e ? 'new' : e.deletedAt ? 'deleted' : (clean(e.name) !== r.name || (e.series ?? null) !== r.series || (r.price && !(Number(e.listPrice) > 0))) ? 'update' : 'same';
      return { ...r, action };
    });
    const count = (a: string) => plan.filter((p) => p.action === a).length;
    const report = { total: rows.length, new: count('new'), update: count('update'), same: count('same'), deleted: count('deleted'), errors, preview: plan.slice(0, 30) };
    if (!apply) return { ...report, applied: false };
    for (const p of plan) {
      if (p.action === 'new') await this.create({ sku: p.sku, name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price ? { price: p.price } : {}) });
      else if (p.action === 'update') {
        const e = by.get(p.sku.toLowerCase())!;
        await this.update(String(e._id), { name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price && !(Number(e.listPrice) > 0) ? { price: p.price } : {}) });
      }
    }
    return { ...report, applied: true };
  }

  /**
   * Изделия из заказов (БЗ-5): позиции заказов, которых ещё нет в «Продукции» (по короткому имени без регистра), → черновики.
   * apply=false — только отчёт. При apply: создаём изделие (status draft, без цены, полное описание из заказа) и ставим
   * позициям productId (только где его не было). Текст и суммы позиций не трогаем — договор.
   */
  async fromOrders(apply: boolean) {
    const lines = await this.db.collection('incomes').find({ ...LIVE, orderId: { $ne: null }, productId: null }, { projection: { title: 1, orderNo: 1 } }).toArray();
    const have = new Map<string, Types.ObjectId>();
    for (const p of await this.db.collection('products').find({ deletedAt: null }, { projection: { name: 1 } }).toArray()) { const k = productNameKey(String(p.name ?? '')); if (!have.has(k)) have.set(k, p._id as Types.ObjectId); }
    const groups = new Map<string, { name: string; description: string; ids: Types.ObjectId[]; orders: Set<string> }>();
    for (const l of lines) {
      const name = shortProductName(String(l.title ?? ''));
      if (!name) continue;
      const key = productNameKey(name);
      const g = groups.get(key) ?? { name, description: String(l.title ?? '').trim(), ids: [], orders: new Set<string>() };
      g.ids.push(l._id as Types.ObjectId); if (l.orderNo) g.orders.add(String(l.orderNo)); groups.set(key, g);
    }
    const plan = [...groups.entries()].map(([key, g]) => ({ key, ...g, action: have.has(key) ? 'exists' : 'new' }));
    const fresh = plan.filter((p) => p.action === 'new');
    const report = { lines: lines.length, new: fresh.length, exists: plan.length - fresh.length, preview: fresh.slice(0, 30).map((p) => ({ name: p.name, lines: p.ids.length, orders: [...p.orders].slice(0, 5) })) };
    if (!apply) return { ...report, applied: false };
    let created = 0;
    for (const p of plan) {
      let productId: Types.ObjectId | null = null;
      if (p.action === 'new') {
        const sku = 'ЗК-' + createHash('md5').update(p.key).digest('hex').slice(0, 6).toUpperCase();
        try { productId = new Types.ObjectId((await this.create({ sku, name: p.name, description: p.description.length > p.name.length ? p.description : '' })).id); created++; } catch { continue; }
      } else {
        const e = have.get(p.key);
        if (!e) continue;
        productId = e;
      }
      await this.db.collection('incomes').updateMany({ _id: { $in: p.ids }, productId: null }, { $set: { productId } });
    }
    return { ...report, applied: true, created };
  }

  /** Данные коммерческого предложения: номер КП, реквизиты нашей компании, заказчик, строки с фото и суммами. */
  async kp(dto: { items?: { id: string; qty?: number; price?: number }[]; companyId?: string; customer?: string; note?: string }) {
    const items = (dto.items ?? []).filter((x) => x?.id);
    if (!items.length) throw new BadRequestException('Выберите изделия для КП');
    const docs = (await this.db.collection('products').find({ _id: { $in: items.map((x) => oid(x.id, 'изделия')) } }).toArray()) as Doc[];
    const pres = new Map((await this.present(docs)).map((p) => [p.id, p]));
    const lines = items.map((x) => {
      const p = pres.get(x.id); if (!p) throw new NotFoundException('Изделие не найдено — обновите витрину');
      const qty = Number(x.qty) > 0 ? Number(x.qty) : 1, price = Number(x.price) >= 0 && x.price !== undefined ? Number(x.price) : p.price ?? 0;
      return { id: p.id, sku: p.sku, name: p.name, series: p.series, group: p.group, qty, price, sum: Math.round(qty * price * 100) / 100, photo: p.photo };
    });
    const co = dto.companyId ? await this.db.collection('organizations').findOne({ _id: oid(dto.companyId, 'компании'), isOurCompany: true })
      : await this.db.collection('organizations').findOne({ isOurCompany: true, deletedAt: null });
    const number = await this.counter.next('CommercialOffer', 'КП');
    return {
      number, date: new Date(), customer: clean(dto.customer) || null, note: String(dto.note ?? '').trim() || null,
      company: co ? { name: co.name, shortName: co.shortName ?? null, inn: String(co.inn ?? '').startsWith('БЕЗ-ИНН') ? null : co.inn, kpp: co.kpp ?? null, address: co.legalAddress ?? null,
        phone: co.phone ?? null, email: co.email ?? null, website: co.website ?? null, bankName: co.bankName ?? null, bankBik: co.bankBik ?? null, bankAccount: co.bankAccount ?? null, bankCorrAccount: co.bankCorrAccount ?? null } : null,
      items: lines, total: Math.round(lines.reduce((s, l) => s + l.sum, 0) * 100) / 100, noPrice: lines.filter((l) => !l.price).length,
    };
  }
}
