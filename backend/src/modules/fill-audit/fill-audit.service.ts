import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { canSeeMoney } from '../../common/roles-hierarchy';

type Q = Record<string, unknown>;
type Item = { id: string; title: string; sub?: string };
/**
 * Одна очередь «требуют заполнения»: что не заполнено, зачем это нужно и куда идти.
 * section + field — раздел приложения и ключ поля формы: клик открывает карточку сразу в правке с подсвеченным полем.
 */
export type FillGroup = { key: string; area: string; title: string; why: string; section: string; field: string; money: boolean; count: number; items: Item[] };

const empty = (f: string) => ({ $or: [{ [f]: null }, { [f]: { $exists: false } }, { [f]: '' }] });
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '');
const dmy = (d: unknown) => iso(d).split('-').reverse().join('.');

/**
 * «Требуют заполнения» по категориям (TASKS ТЗ.1–ТЗ.5). Только чтение. Группы с деньгами видят директор / бухгалтер / админ;
 * остальные — все. Условия «в расходах» — те же, что у платёжного календаря (сумма > 0 и дата счёта): именно эти строки
 * дают «не указано» в «Деньги → Сводка → Куда / На что / Кому».
 */
@Injectable()
export class FillAuditService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  async report(user: { role?: string | null; isOwner?: boolean } | undefined, opts: { limit?: number; only?: string } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200);
    const money = canSeeMoney(user);
    const db = this.db;
    const ours = (await db.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { projection: { _id: 1 } }).toArray()).map((o) => o._id);
    const persons = await db.collection('persons').find({ deletedAt: null }, { projection: { firstName: 1, lastName: 1 } }).toArray();
    const personNames = persons.flatMap((p) => [`${p.firstName ?? ''} ${p.lastName ?? ''}`, `${p.lastName ?? ''} ${p.firstName ?? ''}`].map((x) => x.trim()).filter(Boolean));

    const live = { deletedAt: null, status: { $ne: 'cancelled' } };
    const inExpenses = { ...live, priceHint: { $gt: 0 }, invoiceDate: { $ne: null } };
    const noCompany = { $or: [{ companyId: null }, { companyId: { $exists: false } }, { companyId: { $nin: ours } }] };
    const reqItem = (r: Q): Item => ({ id: String(r._id), title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), sub: [r.invoiceNo ? `счёт ${r.invoiceNo}` : '', r.invoiceDate ? dmy(r.invoiceDate) : r.requestDate ? dmy(r.requestDate) : '', r.requestedBy].filter(Boolean).join(' · ') });
    const incItem = (r: Q): Item => ({ id: String(r._id), title: String(r.title ?? ''), sub: [r.orderNo ? `заказ ${r.orderNo}` : '', r.customer].filter(Boolean).join(' · ') });

    type Def = Omit<FillGroup, 'count' | 'items'> & { coll: string; q: Q; item: (r: Q) => Item; sort: Record<string, 1 | -1> };
    const defs: Def[] = [
      // ── Деньги: без этого платёжный календарь и сводка считают неверно ──
      { key: 'exp-amount', area: 'Деньги', title: 'Счёт есть, суммы нет', why: 'Заявка с датой счёта без суммы не попадает в выплаты', section: 'requests', field: 'priceHint', money: true,
        coll: 'supplyrequests', q: { ...live, invoiceDate: { $ne: null }, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] }, item: reqItem, sort: { invoiceDate: -1 } },
      { key: 'exp-date', area: 'Деньги', title: 'Сумма есть, даты счёта нет', why: 'Без даты счёта выплата не встаёт в календарь', section: 'requests', field: 'invoiceDate', money: true,
        coll: 'supplyrequests', q: { ...live, priceHint: { $gt: 0 }, ...empty('invoiceDate') }, item: reqItem, sort: { requestDate: -1 } },
      { key: 'exp-company', area: 'Деньги', title: 'Не указана наша компания', why: 'Платёжный календарь делится по компаниям — без неё расход теряется', section: 'requests', field: 'companyName', money: true,
        coll: 'supplyrequests', q: { ...inExpenses, ...noCompany }, item: reqItem, sort: { invoiceDate: -1 } },
      { key: 'exp-cost', area: 'Аналитика расходов', title: 'Не указано, куда пошло', why: 'Цех, офис, СМР или заказ — иначе в «Куда тратили» это «не указано»', section: 'requests', field: 'costCenter', money: true,
        coll: 'supplyrequests', q: { ...inExpenses, ...empty('costCenter'), $and: [empty('salesOrderId')] }, item: reqItem, sort: { invoiceDate: -1 } },
      { key: 'exp-supplier', area: 'Аналитика расходов', title: 'Не указан поставщик', why: '«Кому платили» и сверка с поставщиками', section: 'requests', field: 'supplierName', money: true,
        coll: 'supplyrequests', q: { ...inExpenses, ...empty('supplierId') }, item: reqItem, sort: { invoiceDate: -1 } },
      { key: 'exp-category', area: 'Аналитика расходов', title: 'Не указана категория', why: '«На что тратили» — по категориям', section: 'requests', field: 'categoryName', money: true,
        coll: 'supplyrequests', q: { ...inExpenses, ...empty('categoryId') }, item: reqItem, sort: { invoiceDate: -1 } },
      { key: 'inc-amount', area: 'Деньги', title: 'Позиции заказов без суммы', why: 'Не попадают в поступления и в выручку', section: 'orders', field: 'unitPrice', money: true,
        coll: 'incomes', q: { deletedAt: null, $or: [{ amount: null }, { amount: { $exists: false } }, { amount: { $lte: 0 } }] }, item: incItem, sort: { orderNo: -1 } },
      { key: 'inc-company', area: 'Деньги', title: 'Позиции заказов без нашей компании', why: 'Поступление не встаёт в календарь нужной компании', section: 'orders', field: 'companyName', money: true,
        coll: 'incomes', q: { deletedAt: null, ...noCompany }, item: incItem, sort: { orderNo: -1 } },
      // ── Заявки и склад (видят все) ──
      { key: 'req-supplier', area: 'Заявки', title: 'Заказано, но не указан поставщик', why: 'Непонятно, у кого ждать поставку и кому платить', section: 'requests', field: 'supplierName', money: false,
        coll: 'supplyrequests', q: { deletedAt: null, status: { $in: ['ordered', 'paid'] }, ...empty('supplierId') }, item: reqItem, sort: { requestDate: -1 } },
      { key: 'req-category', area: 'Заявки', title: 'Заявки без категории', why: 'Категория нужна для «Категория → Позиция», фильтров и аналитики', section: 'requests', field: 'categoryName', money: false,
        coll: 'supplyrequests', q: { ...live, ...empty('categoryId') }, item: reqItem, sort: { requestDate: -1 } },
      { key: 'req-person', area: 'Сотрудники', title: personNames.length ? '«Кто подал» — не из списка сотрудников' : 'Не указано, кто подал', why: personNames.length ? 'Имя написано не так, как в «Справочники → Сотрудники» — выберите из списка' : 'Видно, чья заявка и кого спросить', section: 'requests', field: 'requestedBy', money: false,
        coll: 'supplyrequests', q: { ...live, $or: [...empty('requestedBy').$or, ...(personNames.length ? [{ requestedBy: { $nin: personNames } }] : [])] }, item: reqItem, sort: { requestDate: -1 } },
      { key: 'so-ship', area: 'Заказы', title: 'Заказы без даты отгрузки', why: 'Без срока заказ не встаёт в очередь «Сегодня» и в план', section: 'salesorders', field: 'shipDate', money: false,
        coll: 'salesorders', q: { deletedAt: null, stage: { $nin: ['shipped', 'closed', 'cancelled'] }, ...empty('shipDate') }, item: (r) => ({ id: String(r._id), title: `№ ${r.orderNo ?? '—'} · ${r.customer ?? ''}`, sub: String(r.title ?? '') }), sort: { orderNo: -1 } },
      { key: 'mat-category', area: 'Склад', title: 'Позиции склада без категории', why: 'Без категории позицию не найти через «Категория → Позиция»', section: 'stock', field: 'categoryName', money: false,
        coll: 'materials', q: { deletedAt: null, ...empty('categoryId') }, item: (r) => ({ id: String(r._id), title: String(r.name ?? ''), sub: r.article ? `арт. ${r.article}` : '' }), sort: { name: 1 } },
    ];

    const groups: FillGroup[] = [];
    for (const d of defs) {
      if (d.money && !money) continue;
      if (opts.only && opts.only !== d.key) continue;
      const c = db.collection(d.coll);
      const [count, rows] = await Promise.all([c.countDocuments(d.q), c.find(d.q).sort(d.sort).limit(limit).toArray()]);
      if (!count) continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- служебные поля описания группы в ответ не идут
      const { coll: _c, q: _q, item, sort: _s, ...g } = d;
      groups.push({ ...g, count, items: rows.map((r) => item(r as Q)) });
    }
    return { total: groups.reduce((s, g) => s + g.count, 0), groups };
  }
}
