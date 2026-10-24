import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { netIssuedByLine } from '../../common/issued-net';
import { oid } from '../../common/list-query';
import { ShowcaseComposition } from '../showcase/showcase-composition';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type CompositionStatus = 'add' | 'change' | 'same';

/** «На одно изделие» = нетто ÷ количество изделий в позиции, до сотых (СК-2); rounded — округление что-то изменило. */
export function perProduct(net: number, qty: number) {
  const q = qty > 0 ? qty : 1;
  const per = r2(net / q);
  return { per, rounded: Math.abs(per * q - net) > 0.0005 };
}

/** Что делать со строкой состава: нет — добавить, другое число — изменить, то же — совпадает. */
export function compareWithComposition(per: number, current: number | null): CompositionStatus {
  if (current == null) return 'add';
  return Math.abs(current - per) < 0.005 ? 'same' : 'change';
}

interface SuggestRow { materialId: string; name: string; unit: string; issued: number; returned: number; net: number; perProduct: number; rounded: boolean; current: number | null; status: CompositionStatus }

/**
 * Состав изделия копится из выдач (SK-7, SKLAD §4/§8): предложение считается каждый раз заново и нигде не хранится.
 * Количество на одно изделие = нетто выдач под позицию заказа (минус возвраты, без отменённых) ÷ количество изделий в позиции.
 * Запись — только по явному accept, через ShowcaseComposition.set (те же проверки, что у «Изменить состав»);
 * считается от суммы выдач, поэтому повтор не удваивает; строки состава не удаляются.
 */
@Injectable()
export class StockCompositionService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }
  private comp = new ShowcaseComposition(() => this.db);

  /** Предложение по позиции заказа. Цены (price/sum/total) — только при `money`. */
  async suggest(salesOrderLineId: string, money: boolean) {
    const lineId = oid(salesOrderLineId, 'позиции заказа');
    const line = await this.db.collection('incomes').findOne({ _id: lineId, deletedAt: null }, { projection: { orderNo: 1, lineNo: 1, title: 1, productId: 1, qty: 1 } });
    if (!line) throw new NotFoundException('Позиция заказа не найдена');
    const qty = Number(line.qty) > 0 ? Number(line.qty) : 1;
    const label = line.orderNo != null && line.lineNo != null ? `${line.orderNo}-${line.lineNo}` : String(line.title ?? '');
    const head = { salesOrderLineId: String(lineId), position: label, title: String(line.title ?? ''), qty };
    if (!line.productId) return { ...head, productId: null, productName: null, reason: 'У позиции нет изделия — выберите изделие в «Продукции», тогда состав можно пополнять из выдач', items: [] as Array<Record<string, unknown>> };
    const product = await this.db.collection('products').findOne({ _id: line.productId, deletedAt: null }, { projection: { name: 1, composition: 1 } });
    if (!product) return { ...head, productId: String(line.productId), productName: null, reason: 'Изделие позиции не найдено (или в корзине)', items: [] as Array<Record<string, unknown>> };

    const moves = await this.db.collection('stockmovements').find({ salesOrderLineId: lineId }, { projection: { type: 1, qty: 1, materialId: 1, salesOrderLineId: 1, isReturn: 1, cancelledAt: 1, cancelOf: 1 } }).toArray();
    const nets = netIssuedByLine(moves as never).filter((n) => n.net > 0);
    const have = new Map<string, number>();
    for (const l of (product.composition as Record<string, unknown>[] | undefined) ?? []) {
      if (l.lineType !== 'material' && l.lineType !== undefined) continue;
      const k = String(l.refId ?? l.materialId);
      have.set(k, r3((have.get(k) ?? 0) + (Number(l.quantity) || 0)));
    }
    const mats = nets.length ? await this.db.collection('materials').find({ _id: { $in: nets.map((n) => new Types.ObjectId(n.materialId)) } }, { projection: { name: 1, unit: 1 } }).toArray() : [];
    const info = new Map(mats.map((m) => [String(m._id), m]));
    const rows: SuggestRow[] = nets.map((n) => {
      const { per, rounded } = perProduct(n.net, qty);
      const current = have.has(n.materialId) ? have.get(n.materialId)! : null;
      return { materialId: n.materialId, name: String(info.get(n.materialId)?.name ?? ''), unit: String(info.get(n.materialId)?.unit ?? 'шт'), issued: n.issued, returned: n.returned, net: n.net,
        perProduct: per, rounded, current, status: compareWithComposition(per, current) };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const base = { ...head, productId: String(product._id), productName: String(product.name ?? ''), reason: rows.length ? null : 'Под эту позицию пока ничего не выдано', items: rows as unknown as Array<Record<string, unknown>> };
    if (!money || !rows.length) return base;
    // себестоимость — как в «Продукции»: последняя закупка, иначе цена справочника; считается по предлагаемому количеству
    const cost = await this.comp.cost(rows.map((r) => ({ lineType: 'material', refId: r.materialId, quantity: r.perProduct })));
    const priced = rows.map((r, i) => ({ ...r, price: (cost?.lines[i]?.price as number | null) ?? null, priceSource: (cost?.lines[i]?.source as string | null) ?? null, sum: (cost?.lines[i]?.sum as number | null) ?? null }));
    return { ...base, items: priced as unknown as Array<Record<string, unknown>>, total: cost?.total ?? 0, missing: cost?.missing ?? 0 };
  }

  /**
   * Принять предложение в состав изделия. materialIds — какие строки принять (по умолчанию все, что отличаются).
   * Остальные строки состава остаются как были; ничего не удаляется. Ответ — свежее предложение + applied.
   */
  async accept(dto: { salesOrderLineId: string; materialIds?: string[] }, money: boolean) {
    const s = await this.suggest(dto.salesOrderLineId, false);
    if (!s.productId) throw new BadRequestException('У позиции нет изделия — состав пополнять некуда');
    const only = dto.materialIds?.length ? new Set(dto.materialIds.map(String)) : null;
    const items = s.items as unknown as SuggestRow[];
    if (only) for (const id of only) if (!items.some((r) => r.materialId === id)) throw new BadRequestException('Материал не выдавался под эту позицию');
    const take = items.filter((r) => r.status !== 'same' && (!only || only.has(r.materialId)));
    if (take.length) {
      const product = await this.db.collection('products').findOne({ _id: new Types.ObjectId(s.productId) }, { projection: { composition: 1 } });
      const note = `Из выдач по позиции ${s.position}`;
      // текущие материалы состава (повторы одного материала сводим в строку) + принятые значения; изделия и модули set не трогает (types: material)
      const lines = new Map<string, { materialId: string; quantity: number; notes?: string }>();
      for (const l of (product?.composition as Record<string, unknown>[] | undefined) ?? []) {
        if (l.lineType !== 'material' && l.lineType !== undefined) continue;
        const k = String(l.refId ?? l.materialId);
        const prev = lines.get(k);
        lines.set(k, { materialId: k, quantity: r3((prev?.quantity ?? 0) + (Number(l.quantity) || 0)), notes: prev?.notes ?? (l.notes ? String(l.notes) : undefined) });
      }
      for (const r of take) lines.set(r.materialId, { materialId: r.materialId, quantity: r.perProduct, notes: lines.get(r.materialId)?.notes ?? note });
      await this.comp.set(s.productId, [...lines.values()].map((l) => ({ lineType: 'material', ...l })), ['material']);
    }
    return { ...(await this.suggest(dto.salesOrderLineId, money)), applied: take.map((r) => ({ materialId: r.materialId, name: r.name, quantity: r.perProduct })) };
  }
}
