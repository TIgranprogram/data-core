import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import type { DataVersionService } from '../../common/data-version/data-version.service';
import { wouldCycle } from './composition-cycle';
import { clean, LIVE, loadPhotos, type Db, type Doc } from './showcase-common';

/** Состав изделия и себестоимость (БЗ-5, СИ); вызывается из ShowcaseService. */
export class ShowcaseComposition {
  constructor(private readonly dbOf: () => Db, private readonly versions?: DataVersionService) {}
  private get db() { return this.dbOf(); }

  /**
   * Состав изделия (БЗ-5, СИ): все строки products.composition — материалы склада, изделия «Продукции», модули (CRM).
   * У вложенного изделия — его состав на 1 уровень (children) для показа в карточке. Неизвестные типы строк — как есть (raw).
   */
  async composition(d: Doc) {
    const lines = (d.composition as Record<string, unknown>[] | undefined) ?? [];
    if (!lines.length) return [];
    const ids = (t: string) => lines.filter((l) => l.lineType === t).map((l) => l.refId as Types.ObjectId);
    const [mats, prods, mods] = await Promise.all([
      this.db.collection('materials').find({ _id: { $in: ids('material') } }, { projection: { name: 1, article: 1, unit: 1, deletedAt: 1 } }).toArray(),
      this.db.collection('products').find({ _id: { $in: ids('product') } }, { projection: { name: 1, sku: 1, unit: 1, photoIds: 1, composition: 1, deletedAt: 1 } }).toArray(),
      this.db.collection('productmodules').find({ _id: { $in: ids('module') } }, { projection: { name: 1, sku: 1, unit: 1 } }).toArray(),
    ]);
    const mBy = new Map(mats.map((m) => [String(m._id), m])); const pBy = new Map(prods.map((p) => [String(p._id), p])); const modBy = new Map(mods.map((m) => [String(m._id), m]));
    // состав вложенных изделий — названия материалов / изделий их строк (1 уровень)
    const inner = prods.flatMap((p) => ((p.composition as Record<string, unknown>[]) ?? []));
    const [im, ip] = await Promise.all([
      this.db.collection('materials').find({ _id: { $in: inner.filter((l) => l.lineType === 'material').map((l) => l.refId as Types.ObjectId) } }, { projection: { name: 1, unit: 1 } }).toArray(),
      this.db.collection('products').find({ _id: { $in: inner.filter((l) => l.lineType === 'product').map((l) => l.refId as Types.ObjectId) } }, { projection: { name: 1 } }).toArray(),
    ]);
    const innerName = new Map([...im, ...ip].map((x) => [String(x._id), x]));
    const ph = await loadPhotos(this.db, prods.flatMap((p) => ((p.photoIds as Types.ObjectId[]) ?? []).slice(0, 1)));
    return lines.map((l) => {
      const base = { id: String(l._id ?? ''), lineType: String(l.lineType ?? ''), refId: String(l.refId ?? ''), quantity: Number(l.quantity) || 0, notes: (l.notes as string) ?? null };
      if (l.lineType === 'material') {
        const m = mBy.get(base.refId);
        return { ...base, materialId: base.refId, name: String(m?.name ?? '(материал удалён)'), article: (m?.article as string) ?? null, unit: String(l.unit ?? m?.unit ?? 'шт'), missing: !m || !!m.deletedAt };
      }
      if (l.lineType === 'product') {
        const p = pBy.get(base.refId);
        const first = ((p?.photoIds as Types.ObjectId[]) ?? [])[0];
        const children = ((p?.composition as Record<string, unknown>[]) ?? []).filter((x) => x.lineType === 'material' || x.lineType === 'product')
          .map((x) => { const n = innerName.get(String(x.refId)); return { lineType: String(x.lineType), name: String(n?.name ?? '(удалено)'), quantity: Number(x.quantity) || 0, unit: String(x.unit ?? n?.unit ?? 'шт') }; });
        return { ...base, productId: base.refId, name: String(p?.name ?? '(изделие удалено)'), article: (p?.sku as string) ?? null, unit: String(l.unit ?? 'шт'), photo: first ? ph.get(String(first)) ?? null : null, children, missing: !p || !!p.deletedAt };
      }
      if (l.lineType === 'module') {
        const m = modBy.get(base.refId);
        return { ...base, moduleId: base.refId, name: String(m?.name ?? '(модуль удалён)'), article: (m?.sku as string) ?? null, unit: String(l.unit ?? m?.unit ?? 'шт'), missing: !m };
      }
      return { ...base, name: '(строка CRM)', article: null, unit: String(l.unit ?? ''), raw: true };
    });
  }

  /**
   * Заменить строки состава (СИ). lines: [{ lineType?: material|product|module (по умолчанию material), materialId | productId |
   * moduleId | refId, quantity, notes? }]; types — какие типы строк заменяются (по умолчанию — те, что пришли, иначе только
   * material: старое тело с одними материалами работает как раньше). Строки остальных типов (и неизвестные) — как есть.
   * Изделие не может входить само в себя (на любой глубине) — 400.
   */
  async set(id: string, lines: Array<{ lineType?: string; materialId?: string; productId?: string; moduleId?: string; refId?: string; quantity?: number | string; notes?: string }>, types?: string[]) {
    const _id = oid(id, 'изделия');
    const d = await this.db.collection('products').findOne({ _id, deletedAt: null });
    if (!d) throw new NotFoundException('Изделие не найдено');
    if (!Array.isArray(lines) || lines.length > 300) throw new BadRequestException('Некорректный состав');
    const KNOWN = ['material', 'product', 'module'] as const;
    const typeOf = (l: { lineType?: string }) => String(l.lineType || 'material');
    for (const l of lines) if (!(KNOWN as readonly string[]).includes(typeOf(l))) throw new BadRequestException(`Неизвестный тип строки: ${typeOf(l)}`);
    const replace = new Set((Array.isArray(types) && types.length ? types : lines.length ? lines.map(typeOf) : ['material']).filter((t) => (KNOWN as readonly string[]).includes(t)));
    const refOf = (l: (typeof lines)[number]) => String((typeOf(l) === 'material' ? l.materialId : typeOf(l) === 'product' ? l.productId : l.moduleId) ?? l.refId ?? '');
    const refs = lines.map((l) => oid(refOf(l), typeOf(l) === 'material' ? 'материала' : typeOf(l) === 'product' ? 'изделия' : 'модуля'));
    const pick = (t: string) => refs.filter((_, i) => typeOf(lines[i]) === t);
    const [mats, prods, mods] = await Promise.all([
      this.db.collection('materials').find({ _id: { $in: pick('material') } }, { projection: { unit: 1 } }).toArray(),
      this.db.collection('products').find({ _id: { $in: pick('product') }, deletedAt: null }, { projection: { unit: 1 } }).toArray(),
      this.db.collection('productmodules').find({ _id: { $in: pick('module') } }, { projection: { unit: 1 } }).toArray(),
    ]);
    const found = { material: new Map(mats.map((m) => [String(m._id), m])), product: new Map(prods.map((m) => [String(m._id), m])), module: new Map(mods.map((m) => [String(m._id), m])) };
    // изделие внутри самого себя — по всей глубине (граф: изделие → изделия его состава)
    const childProducts = pick('product').map(String);
    if (childProducts.length) {
      const all = await this.db.collection('products').find({ 'composition.lineType': 'product' }, { projection: { composition: 1 } }).toArray();
      const graph = new Map(all.map((p) => [String(p._id), ((p.composition as Record<string, unknown>[]) ?? []).filter((x) => x.lineType === 'product').map((x) => String(x.refId))]));
      graph.delete(String(_id)); // свой состав заменяем — старые строки не в счёт
      const bad = wouldCycle(String(_id), childProducts, graph);
      if (bad) throw new BadRequestException(bad === String(_id) ? 'Изделие не может входить само в себя' : 'Изделие не может входить само в себя: выбранное изделие уже содержит это (через свой состав)');
    }
    const seen = new Set<string>();
    const next = lines.map((l, i) => {
      const t = typeOf(l) as (typeof KNOWN)[number]; const key = `${t}:${String(refs[i])}`;
      const ref = found[t].get(String(refs[i]));
      if (!ref) throw new BadRequestException(t === 'material' ? 'Материал не найден в справочнике' : t === 'product' ? 'Изделие не найдено (или в корзине)' : 'Модуль не найден');
      if (seen.has(key)) throw new BadRequestException('Одна позиция указана дважды — сложите количество в одну строку');
      seen.add(key);
      const q = Number(String(l.quantity ?? '').replace(',', '.'));
      if (!Number.isFinite(q) || q <= 0) throw new BadRequestException('Количество должно быть больше нуля');
      return { _id: new Types.ObjectId(), lineType: t, refId: refs[i], quantity: q, sortOrder: i, unit: String(ref.unit ?? 'шт'), notes: clean(l.notes) || undefined };
    });
    const others = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => !replace.has(String(l.lineType)));
    await this.db.collection('products').updateOne({ _id }, { $set: { composition: [...next, ...others], updatedAt: new Date() } });
    return id;
  }

  /** «Часто в похожих изделиях» (СИ): строки составов изделий той же группы, по частоте; без своих. */
  /** Кэш по версиям products и materials (имена) и id изделия; соседей — не больше 500 последних. */
  similar(id: string) {
    const run = () => this.buildSimilar(id);
    return this.versions ? this.versions.cached('showcase.similar', ['products', 'materials'], id, run) : run();
  }

  private async buildSimilar(id: string) {
    const d = await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { categoryId: 1, composition: 1 } });
    if (!d?.categoryId) return { items: [] };
    const own = new Set(((d.composition as Record<string, unknown>[]) ?? []).map((l) => `${l.lineType}:${l.refId}`));
    const peers = await this.db.collection('products').find({ ...LIVE, categoryId: d.categoryId, _id: { $ne: d._id }, 'composition.0': { $exists: true } }, { projection: { composition: 1 } }).sort({ _id: -1 }).limit(500).toArray();
    const n = new Map<string, { lineType: string; refId: string; n: number }>();
    for (const p of peers) for (const l of (p.composition as Record<string, unknown>[]) ?? []) {
      if (l.lineType !== 'material' && l.lineType !== 'product') continue;
      const k = `${l.lineType}:${l.refId}`; if (own.has(k)) continue;
      n.set(k, { lineType: String(l.lineType), refId: String(l.refId), n: (n.get(k)?.n ?? 0) + 1 });
    }
    const top = [...n.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const names = new Map([...(await this.db.collection('materials').find({ _id: { $in: top.filter((x) => x.lineType === 'material').map((x) => new Types.ObjectId(x.refId)) } }, { projection: { name: 1, unit: 1 } }).toArray()),
      ...(await this.db.collection('products').find({ _id: { $in: top.filter((x) => x.lineType === 'product').map((x) => new Types.ObjectId(x.refId)) } }, { projection: { name: 1, unit: 1 } }).toArray())].map((x) => [String(x._id), x]));
    return { items: top.map((x) => ({ ...x, name: String(names.get(x.refId)?.name ?? ''), unit: String(names.get(x.refId)?.unit ?? 'шт') })).filter((x) => x.name) };
  }

  /**
   * Себестоимость (БЗ-5, СИ): количество × цена за единицу. Материал — последняя закупка (заявка снабжения, не отменённая:
   * сумма строки / количество; сумма — priceHint «Сумма с НДС» или lineTotal), иначе цена справочника (pricePerUnit).
   * Вложенное изделие — себестоимость его состава (рекурсивно, без циклов). Модуль — без цены. Только расчёт, в изделие
   * не пишется (costPrice — поле CRM). Строки без цены в сумму не входят, их число — missing.
   */
  async cost(lines: Array<{ lineType?: string; refId?: string; materialId?: string; quantity: number }>, depth = 0, path: string[] = []): Promise<{ total: number; missing: number; lines: Array<Record<string, unknown>> } | null> {
    if (!lines.length) return null;
    const norm = lines.map((l) => ({ lineType: l.lineType || 'material', refId: String(l.refId || l.materialId || ''), quantity: l.quantity }));
    const matIds = norm.filter((l) => l.lineType === 'material' && Types.ObjectId.isValid(l.refId)).map((l) => new Types.ObjectId(l.refId));
    const [last, mats] = await Promise.all([
      matIds.length ? this.db.collection('supplyrequests').aggregate([
        { $match: { deletedAt: null, materialId: { $in: matIds }, status: { $ne: 'cancelled' }, qty: { $gt: 0 }, $or: [{ priceHint: { $gt: 0 } }, { lineTotal: { $gt: 0 } }] } },
        { $sort: { requestDate: -1, createdAt: -1 } },
        { $group: { _id: '$materialId', priceHint: { $first: '$priceHint' }, lineTotal: { $first: '$lineTotal' }, qty: { $first: '$qty' }, receivedQty: { $first: '$receivedQty' }, date: { $first: { $ifNull: ['$requestDate', '$createdAt'] } } } },
      ]).toArray() : Promise.resolve([]),
      matIds.length ? this.db.collection('materials').find({ _id: { $in: matIds } }, { projection: { pricePerUnit: 1 } }).toArray() : Promise.resolve([]),
    ]);
    const unitPrice = (x: Record<string, unknown>) => (Number(x.priceHint) > 0 ? Number(x.priceHint) : Number(x.lineTotal)) / (Number(x.receivedQty) > 0 ? Number(x.receivedQty) : Number(x.qty));
    const buy = new Map(last.map((x) => [String(x._id), { price: unitPrice(x), date: (x.date as Date) ?? null }]));
    const ref = new Map(mats.map((m) => [String(m._id), Number(m.pricePerUnit) > 0 ? Number(m.pricePerUnit) : null]));
    let innerMissing = 0;
    const rows: Array<Record<string, unknown> & { price: number | null; sum: number | null }> = [];
    for (const l of norm) {
      if (l.lineType === 'material') {
        const b = buy.get(l.refId); const r = ref.get(l.refId) ?? null;
        const price = b ? Math.round(b.price * 100) / 100 : r;
        rows.push({ lineType: 'material', refId: l.refId, materialId: l.refId, price, source: b ? 'purchase' : r != null ? 'reference' : null, date: b?.date ?? null, sum: price != null ? Math.round(price * l.quantity * 100) / 100 : null });
      } else if (l.lineType === 'product' && depth < 6 && !path.includes(l.refId) && Types.ObjectId.isValid(l.refId)) {
        const p = await this.db.collection('products').findOne({ _id: new Types.ObjectId(l.refId) }, { projection: { composition: 1 } });
        const sub = await this.cost(((p?.composition as Array<{ lineType?: string; refId?: unknown; quantity?: number }>) ?? []).map((x) => ({ lineType: x.lineType, refId: String(x.refId), quantity: Number(x.quantity) || 0 })), depth + 1, [...path, l.refId]);
        const price = sub && sub.total > 0 ? sub.total : null;
        if (sub?.missing) innerMissing += sub.missing;
        rows.push({ lineType: 'product', refId: l.refId, price, source: price != null ? 'composition' : null, partial: !!sub?.missing, sum: price != null ? Math.round(price * l.quantity * 100) / 100 : null });
      } else rows.push({ lineType: l.lineType, refId: l.refId, price: null, source: null, sum: null });
    }
    return { total: Math.round(rows.reduce((s, x) => s + (x.sum ?? 0), 0) * 100) / 100, missing: rows.filter((x) => x.price == null).length + innerMissing, lines: rows };
  }
}
