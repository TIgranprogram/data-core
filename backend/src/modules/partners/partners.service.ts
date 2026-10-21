import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe } from '../../common/list-query';

type Doc = Record<string, unknown>;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: unknown) => clean(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '');
/** Заглушка ИНН из синхронизации таблиц — человеку не показываем. */
const realInn = (inn: unknown) => (inn && !String(inn).startsWith('БЕЗ-ИНН') ? String(inn) : null);
const CUST = 'c:';

/**
 * «Контрагенты» (TASKS фаза 4, решение 2026-10-20) — поверх уже существующих данных, без переноса:
 *  - поставщики и наши компании — `organizations` (на них ссылаются заявки `supplyrequests.supplierId`, деньги — `companyId`);
 *  - заказчики — текст `customer` в заказах (`salesorders`) и их позициях (`incomes`); id вида `c:<название>`.
 * CRM-коллекция `counterparties` пуста и не используется. Объединение дублей: поставщик — заявки переводятся
 * на оставшегося, лишний — в корзину; заказчик — написание заменяется во всех заказах и позициях.
 */
@Injectable()
export class PartnersService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  async list(q: Record<string, unknown> = {}) {
    const type = String(q.type || 'supplier');
    const s = norm(q.search);
    const items = type === 'customer' ? await this.customers() : await this.suppliers(type === 'our');
    const filtered = s ? items.filter((x) => norm([x.name, x.inn, x.email, x.phone].filter(Boolean).join(' ')).includes(s)) : items;
    const [sup, cust, our] = await Promise.all([
      this.db.collection('organizations').countDocuments({ deletedAt: null, isOurCompany: { $ne: true } }),
      this.customers().then((c) => c.length),
      this.db.collection('organizations').countDocuments({ deletedAt: null, isOurCompany: true }),
    ]);
    return { items: filtered, total: filtered.length, page: 1, limit: filtered.length, counts: { supplier: sup, customer: cust, our } };
  }

  private async suppliers(our: boolean) {
    const orgs = await this.db.collection('organizations').find({ deletedAt: null, isOurCompany: our ? true : { $ne: true } }).toArray();
    const ids = orgs.map((o) => o._id);
    const field = our ? 'companyId' : 'supplierId';
    const agg = await this.db.collection('supplyrequests').aggregate([
      { $match: { [field]: { $in: ids }, deletedAt: null } },
      { $group: { _id: `$${field}`, n: { $sum: 1 }, sum: { $sum: { $ifNull: ['$priceHint', 0] } }, last: { $max: '$requestDate' } } },
    ]).toArray();
    const by = new Map(agg.map((a) => [String(a._id), a]));
    return orgs.map((o) => {
      const a = by.get(String(o._id));
      return {
        id: String(o._id), kind: our ? 'our' : 'supplier', name: String(o.name), inn: realInn(o.inn),
        email: (o.email as string) || null, phone: (o.phone as string) || null, website: (o.website as string) || null, notes: (o.notes as string) || null,
        requests: a?.n ?? 0, sum: a?.sum ?? 0, lastDate: a?.last ?? null,
      };
    }).sort((x, y) => y.requests - x.requests || x.name.localeCompare(y.name, 'ru'));
  }

  private async customers() {
    const agg = await this.db.collection('salesorders').aggregate([
      { $match: { deletedAt: null, customer: { $nin: [null, ''] } } },
      { $group: { _id: '$customer', n: { $sum: 1 }, active: { $sum: { $cond: [{ $in: [{ $ifNull: ['$stage', 'new'] }, ['new', 'production', 'ready']] }, 1, 0] } }, last: { $max: '$shipDate' } } },
    ]).toArray();
    const sums = await this.db.collection('incomes').aggregate([
      { $match: { deletedAt: null, customer: { $nin: [null, ''] } } },
      { $group: { _id: '$customer', sum: { $sum: { $ifNull: ['$amount', 0] } } } },
    ]).toArray();
    const sum = new Map(sums.map((x) => [String(x._id), x.sum as number]));
    return agg.map((a) => ({
      id: CUST + String(a._id), kind: 'customer', name: String(a._id), inn: null, email: null, phone: null, website: null, notes: null,
      orders: a.n as number, activeOrders: a.active as number, sum: sum.get(String(a._id)) ?? 0, lastDate: a.last ?? null,
    })).sort((x, y) => y.orders - x.orders || x.name.localeCompare(y.name, 'ru'));
  }

  async get(id: string) {
    if (id.startsWith(CUST)) {
      const name = id.slice(CUST.length);
      const c = (await this.customers()).find((x) => x.name === name);
      if (!c) throw new NotFoundException('Заказчик не найден');
      const orders = await this.db.collection('salesorders').find({ customer: name, deletedAt: null }).sort({ shipDate: -1 }).limit(100)
        .project({ orderNo: 1, stage: 1, shipDate: 1, title: 1 }).toArray();
      // по каждому заказу — позиций, сумма и оплачено (как в «Заказах»); деньги скрывает MoneyMaskInterceptor
      const agg = orders.length ? await this.db.collection('incomes').aggregate([
        { $match: { orderId: { $in: orders.map((o) => o._id) }, deletedAt: null } },
        { $group: { _id: '$orderId', lines: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $ifNull: ['$paidDate', false] }, '$amount', 0] } } } },
      ]).toArray() : [];
      const s = new Map(agg.map((a) => [String(a._id), a]));
      return { ...c, related: orders.map((o) => { const a = s.get(String(o._id)); return { ...o, id: String(o._id), _id: String(o._id), lineCount: a?.lines ?? 0, amount: a?.amount ?? 0, paidAmount: a?.paid ?? 0 }; }) };
    }
    const _id = this.oid(id);
    const o = await this.db.collection('organizations').findOne({ _id, deletedAt: null });
    if (!o) throw new NotFoundException('Контрагент не найден');
    const our = o.isOurCompany === true;
    const row = (await this.suppliers(our)).find((x) => x.id === id)!;
    const reqs = await this.db.collection('supplyrequests').find({ [our ? 'companyId' : 'supplierId']: _id, deletedAt: null }).sort({ requestDate: -1 }).limit(100)
      .project({ num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, requestDate: 1, priceHint: 1 }).toArray();
    return { ...row, related: reqs.map((r) => ({ ...r, id: String(r._id), _id: String(r._id) })) };
  }

  /** Правка: поставщик — название, ИНН, почта, телефон, сайт, примечание; заказчик — только название (во всех заказах). */
  async update(id: string, dto: { name?: string; inn?: string; email?: string; phone?: string; website?: string; notes?: string }) {
    if (id.startsWith(CUST)) {
      const from = id.slice(CUST.length);
      const to = clean(dto.name);
      if (!to) throw new BadRequestException('Название не может быть пустым');
      await this.renameCustomer(from, to);
      return this.get(CUST + to);
    }
    const _id = this.oid(id);
    const set: Doc = {};
    if (dto.name !== undefined) { const n = clean(dto.name); if (!n) throw new BadRequestException('Название не может быть пустым'); set.name = n; }
    if (dto.inn !== undefined) {
      const inn = clean(dto.inn).replace(/\s/g, '');
      if (inn && !/^\d{10}(\d{2})?$/.test(inn)) throw new BadRequestException('ИНН — 10 цифр (организация) или 12 (ИП)');
      if (inn) {
        const twin = await this.db.collection('organizations').findOne({ inn, _id: { $ne: _id }, deletedAt: null });
        if (twin) throw new ConflictException(`ИНН ${inn} уже у «${twin.name}» — объедините их кнопкой «Объединить»`);
        set.inn = inn;
      }
    }
    for (const k of ['email', 'phone', 'website', 'notes'] as const) if (dto[k] !== undefined) set[k] = clean(dto[k]) || null;
    const res = await this.db.collection('organizations').updateOne({ _id, deletedAt: null }, { $set: { ...set, updatedAt: new Date() } });
    if (!res.matchedCount) throw new NotFoundException('Контрагент не найден');
    return this.get(id);
  }

  /** Объединить дубль `id` с `intoId`: всё связанное переходит к `intoId`. */
  async merge(id: string, intoId: string) {
    if (!intoId || id === intoId) throw new BadRequestException('Выберите, с кем объединить');
    if (id.startsWith(CUST) !== intoId.startsWith(CUST)) throw new BadRequestException('Поставщика можно объединить только с поставщиком, заказчика — с заказчиком');
    if (id.startsWith(CUST)) {
      const to = intoId.slice(CUST.length);
      const n = await this.renameCustomer(id.slice(CUST.length), to);
      return { ...(await this.get(intoId)), moved: n };
    }
    const from = this.oid(id), to = this.oid(intoId);
    const [a, b] = await Promise.all([
      this.db.collection('organizations').findOne({ _id: from, deletedAt: null }),
      this.db.collection('organizations').findOne({ _id: to, deletedAt: null }),
    ]);
    if (!a || !b) throw new NotFoundException('Контрагент не найден');
    if (a.isOurCompany || b.isOurCompany) throw new BadRequestException('Наши компании не объединяются');
    const r = await this.db.collection('supplyrequests').updateMany({ supplierId: from }, { $set: { supplierId: to, editedInApp: true } });
    const fill: Doc = {};
    for (const k of ['email', 'phone', 'website', 'notes']) if (!b[k] && a[k]) fill[k] = a[k];
    if (!realInn(b.inn) && realInn(a.inn)) fill.inn = a.inn;
    await this.db.collection('organizations').updateOne({ _id: from }, { $set: { deletedAt: new Date(), mergedInto: to, inn: `${a.inn}-merged-${String(from).slice(-6)}` } });
    if (Object.keys(fill).length) await this.db.collection('organizations').updateOne({ _id: to }, { $set: fill });
    return { ...(await this.get(intoId)), moved: r.modifiedCount };
  }

  private async renameCustomer(from: string, to: string) {
    const re = new RegExp(`^\\s*${escapeRe(from)}\\s*$`);
    const [a, b] = await Promise.all([
      this.db.collection('salesorders').updateMany({ customer: re }, { $set: { customer: to, updatedAt: new Date() } }),
      this.db.collection('incomes').updateMany({ customer: re }, { $set: { customer: to, editedInApp: true } }),
    ]);
    if (!a.matchedCount && !b.matchedCount) throw new NotFoundException('Заказчик не найден');
    return a.modifiedCount + b.modifiedCount;
  }

  private oid(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id контрагента');
    return new Types.ObjectId(id);
  }
}
