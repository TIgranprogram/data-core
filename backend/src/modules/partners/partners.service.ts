import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { escapeRe } from '../../common/list-query';

type Doc = Record<string, unknown>;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: unknown) => clean(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '');
/** Заглушка ИНН из синхронизации таблиц — человеку не показываем. */
const realInn = (inn: unknown) => (inn && !String(inn).startsWith('БЕЗ-ИНН') ? String(inn) : null);
const CUST = 'c:';
/** Реквизиты контрагента (СП.1): поля CRM-схемы organizations + контакт (contactName/contactPhone — только data-core). */
export const REQUISITES = ['kpp', 'legalAddress', 'phone', 'email', 'website', 'bankName', 'bankBik', 'bankAccount', 'bankCorrAccount', 'contactName', 'contactPhone', 'notes', 'directorName', 'trademark'] as const;
export type PartnerInput = { kind?: string; name?: string; inn?: string } & Partial<Record<(typeof REQUISITES)[number], string | null>>;
const DIGITS: Record<string, [RegExp, string]> = {
  kpp: [/^\d{9}$/, 'КПП — 9 цифр'], bankBik: [/^\d{9}$/, 'БИК — 9 цифр'],
  bankAccount: [/^\d{20}$/, 'Расчётный счёт — 20 цифр'], bankCorrAccount: [/^\d{20}$/, 'Корр. счёт — 20 цифр'],
};
const requisites = (o: Doc | null | undefined) => Object.fromEntries(REQUISITES.map((k) => [k, (o?.[k] as string) || null])) as Record<(typeof REQUISITES)[number], string | null>;
/** Заказчик, заведённый в «Контрагентах» (реквизиты): организация с type 'customer' (поле CRM-схемы). */
const CUSTOMER_ORG = { type: 'customer', isOurCompany: { $ne: true } };
const NOT_CUSTOMER_ONLY = { $or: [{ type: { $ne: 'customer' } }, { type: 'supplier' }] };
const exact = (name: string, i = false) => new RegExp(`^\\s*${escapeRe(name)}\\s*$`, i ? 'i' : '');
const stubInn = (name: string) => `БЕЗ-ИНН-${createHash('md5').update(norm(name) + Date.now()).digest('hex').slice(0, 8)}`;
/** Поля, которыми другие таблицы (в т.ч. CRM kppdf) ссылаются на организацию — проверка перед удалением. */
const ORG_REF_FIELDS = ['organizationId', 'supplierId', 'customerId', 'companyId', 'counterpartyId', 'orgId', 'contractorId'];

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
    if (String(q.deleted) === '1') return this.trash();
    const s = norm(q.search);
    const items = type === 'customer' ? await this.customers() : await this.suppliers(type === 'our');
    const filtered = s ? items.filter((x) => norm([x.name, x.inn, x.email, x.phone].filter(Boolean).join(' ')).includes(s)) : items;
    const [sup, cust, our] = await Promise.all([
      this.db.collection('organizations').countDocuments({ deletedAt: null, isOurCompany: { $ne: true }, ...NOT_CUSTOMER_ONLY }),
      this.customers().then((c) => c.length),
      this.db.collection('organizations').countDocuments({ deletedAt: null, isOurCompany: true }),
    ]);
    return { items: filtered, total: filtered.length, page: 1, limit: filtered.length, counts: { supplier: sup, customer: cust, our } };
  }

  private async suppliers(our: boolean) {
    const orgs = await this.db.collection('organizations').find({ deletedAt: null, ...(our ? { isOurCompany: true } : { isOurCompany: { $ne: true }, ...NOT_CUSTOMER_ONLY }) }).toArray();
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
        id: String(o._id), kind: our ? 'our' : 'supplier', name: String(o.name), inn: realInn(o.inn), ...requisites(o),
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
    // реквизиты заказчика — в организации type 'customer' с тем же названием (СП.1); заведённый без заказов — тоже в списке
    const orgs = await this.db.collection('organizations').find({ deletedAt: null, ...CUSTOMER_ORG }).toArray();
    const byName = new Map(orgs.map((o) => [norm(o.name), o]));
    const rows = agg.map((a) => {
      const o = byName.get(norm(a._id)); byName.delete(norm(a._id));
      return { id: CUST + String(a._id), kind: 'customer', name: String(a._id), orgId: o ? String(o._id) : null, inn: realInn(o?.inn), ...requisites(o),
        orders: a.n as number, activeOrders: a.active as number, sum: sum.get(String(a._id)) ?? 0, lastDate: (a.last as Date | null) ?? null };
    });
    for (const o of byName.values()) rows.push({ id: CUST + String(o.name), kind: 'customer', name: String(o.name), orgId: String(o._id), inn: realInn(o.inn), ...requisites(o), orders: 0, activeOrders: 0, sum: 0, lastDate: null });
    return rows.sort((x, y) => y.orders - x.orders || x.name.localeCompare(y.name, 'ru'));
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
      return { ...c, related: orders.map((o) => { const a = s.get(String(o._id)); return { ...o, id: String(o._id), _id: String(o._id), lineCount: a?.lines ?? 0, amount: a?.amount ?? 0, paidAmount: a?.paid ?? 0 }; }),
        ...(await this.stockByOrders(orders)) };
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

  /**
   * Склад по заказам заказчика (TASKS ЗК.3 / Б.3): брони (активные и выданные, по названию брони) и выдачи со склада
   * под эти заказы — кому выдано. Только чтение; последние 50 выдач.
   */
  private async stockByOrders(orders: Doc[]) {
    const ids = orders.map((o) => o._id as Types.ObjectId);
    if (!ids.length) return { reservations: [], issues: [] };
    const orderNo = new Map(orders.map((o) => [String(o._id), String(o.orderNo ?? '')]));
    const [res, mvs] = await Promise.all([
      this.db.collection('reservations').find({ salesOrderId: { $in: ids }, deletedAt: null, status: { $in: ['active', 'fulfilled'] } }, { projection: { batchId: 1, groupName: 1, orderId: 1, qty: 1, issuedQty: 1, status: 1, createdAt: 1, salesOrderId: 1 } }).toArray(),
      this.db.collection('stockmovements').find({ salesOrderId: { $in: ids }, type: 'out', deletedAt: null, cancelledAt: null }, { projection: { date: 1, materialId: 1, qty: 1, issuedToPersonId: 1, issuedTo: 1, salesOrderId: 1 } }).sort({ date: -1 }).limit(50).toArray(),
    ]);
    const groups = new Map<string, { key: string; name: string; orderId: string; orderNo: string; createdAt: unknown; lines: number; left: number; issued: number }>();
    for (const r of res) {
      const key = String(r.batchId ?? r._id);
      const g = groups.get(key) ?? { key, name: String(r.groupName || r.orderId || 'Бронь'), orderId: String(r.salesOrderId), orderNo: orderNo.get(String(r.salesOrderId)) ?? '', createdAt: r.createdAt, lines: 0, left: 0, issued: 0 };
      g.lines++;
      if (r.status === 'active') g.left += Number(r.qty) || 0;
      g.issued += Number(r.issuedQty ?? (r.status === 'fulfilled' ? r.qty : 0)) || 0;
      groups.set(key, g);
    }
    const [mats, persons] = await Promise.all([
      this.db.collection('materials').find({ _id: { $in: mvs.map((m) => m.materialId) } }, { projection: { name: 1, unit: 1 } }).toArray(),
      this.db.collection('persons').find({ _id: { $in: mvs.map((m) => m.issuedToPersonId).filter(Boolean) } }, { projection: { lastName: 1, firstName: 1 } }).toArray(),
    ]);
    const mat = new Map(mats.map((m) => [String(m._id), m]));
    const pn = new Map(persons.map((p) => [String(p._id), [p.lastName, p.firstName].filter(Boolean).join(' ')]));
    return {
      reservations: [...groups.values()],
      issues: mvs.map((m) => ({ id: String(m._id), date: m.date, qty: m.qty, name: String(mat.get(String(m.materialId))?.name ?? ''), unit: String(mat.get(String(m.materialId))?.unit ?? ''),
        orderId: String(m.salesOrderId), orderNo: orderNo.get(String(m.salesOrderId)) ?? '',
        to: [m.issuedToPersonId ? pn.get(String(m.issuedToPersonId)) : null, m.issuedTo].filter(Boolean).join(' · ') || null })),
    };
  }

  /** Проверка и нормализация реквизитов (пусто → null; ИНН/КПП/БИК/счета — цифры). */
  private async cleanRequisites(dto: PartnerInput, selfId?: Types.ObjectId) {
    const set: Doc = {};
    if (dto.inn !== undefined) {
      const inn = clean(dto.inn).replace(/\s/g, '');
      if (inn && !/^\d{10}(\d{2})?$/.test(inn)) throw new BadRequestException('ИНН — 10 цифр (организация) или 12 (ИП)');
      if (inn) {
        const twin = await this.db.collection('organizations').findOne({ inn, ...(selfId ? { _id: { $ne: selfId } } : {}), deletedAt: null });
        if (twin) throw new ConflictException(`ИНН ${inn} уже у «${twin.name}» — объедините их кнопкой «Объединить»`);
        set.inn = inn;
      }
    }
    for (const k of REQUISITES) {
      if (dto[k] === undefined) continue;
      let v = clean(dto[k]);
      if (DIGITS[k]) { v = v.replace(/\s/g, ''); if (v && !DIGITS[k][0].test(v)) throw new BadRequestException(DIGITS[k][1]); }
      if (k === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new BadRequestException('Почта — в виде name@example.ru');
      set[k] = v || null;
    }
    return set;
  }

  private newOrg(name: string, kind: string, set: Doc) {
    const now = new Date();
    return this.db.collection('organizations').insertOne({
      ...set, name, inn: (set.inn as string) || stubInn(name), isOurCompany: kind === 'our', type: kind === 'our' ? [] : [kind], partyTypes: [], isActive: true,
      paymentTermDays: 10, vatRate: 20, photoIds: [], assets: [], deletedAt: null, createdAt: now, updatedAt: now, editedInApp: true,
    });
  }

  /** «+ Новый контрагент» (СП.1): поставщик / заказчик / наша компания — запись в organizations. */
  async create(dto: PartnerInput) {
    const kind = String(dto.kind || 'supplier');
    if (!['supplier', 'customer', 'our'].includes(kind)) throw new BadRequestException('Кто это: поставщик, заказчик или наша компания');
    const name = clean(dto.name);
    if (!name) throw new BadRequestException('Впишите название');
    const same = await this.db.collection('organizations').findOne({ deletedAt: null, name: exact(name, true) });
    if (same) throw new ConflictException(`«${same.name}» уже есть в контрагентах — откройте его`);
    if (kind === 'customer' && (await this.customers()).some((c) => norm(c.name) === norm(name))) throw new ConflictException(`Заказчик «${name}» уже есть — откройте его`);
    const { insertedId } = await this.newOrg(name, kind, await this.cleanRequisites(dto));
    return this.get(kind === 'customer' ? CUST + name : String(insertedId));
  }

  /** Правка: реквизиты и название; у заказчика название меняется во всех заказах, реквизиты — в его организации (создаётся при первой правке). */
  async update(id: string, dto: PartnerInput) {
    if (id.startsWith(CUST)) {
      const from = id.slice(CUST.length);
      const to = dto.name === undefined ? from : clean(dto.name);
      if (!to) throw new BadRequestException('Название не может быть пустым');
      const org = await this.db.collection('organizations').findOne({ deletedAt: null, ...CUSTOMER_ORG, name: exact(from, true) });
      const set = await this.cleanRequisites(dto, org?._id as Types.ObjectId | undefined);
      if (to !== from) {
        const hasOrders = await this.db.collection('salesorders').countDocuments({ customer: exact(from), deletedAt: null });
        if (hasOrders) await this.renameCustomer(from, to);
        else if (!org) throw new NotFoundException('Заказчик не найден');
        set.name = to;
      }
      if (Object.keys(set).length) {
        if (org) await this.db.collection('organizations').updateOne({ _id: org._id }, { $set: { ...set, updatedAt: new Date(), editedInApp: true } });
        else await this.newOrg(to, 'customer', set); // заказчик был только текстом в заказах — заводим ему карточку реквизитов
      }
      return this.get(CUST + to);
    }
    const _id = this.oid(id);
    const set = await this.cleanRequisites(dto, _id);
    if (dto.name !== undefined) { const n = clean(dto.name); if (!n) throw new BadRequestException('Название не может быть пустым'); set.name = n; }
    const res = await this.db.collection('organizations').updateOne({ _id, deletedAt: null }, { $set: { ...set, updatedAt: new Date(), editedInApp: true } });
    if (!res.matchedCount) throw new NotFoundException('Контрагент не найден');
    return this.get(id);
  }

  /**
   * В корзину (СП.1). Нельзя, если на контрагента ссылаются заявки / заказы / записи CRM — 409 с причиной (CANON §2 «Удаление»).
   * Заказчик с заказами не удаляется (он — текст в заказах): дубль написания — «Объединить с…».
   */
  async remove(id: string) {
    let _id: Types.ObjectId;
    if (id.startsWith(CUST)) {
      const name = id.slice(CUST.length);
      const n = await this.db.collection('salesorders').countDocuments({ customer: exact(name), deletedAt: null });
      if (n) throw new ConflictException(`У заказчика ${n} заказ(ов) — удалить нельзя. Дубль написания — «Объединить с…»`);
      const org = await this.db.collection('organizations').findOne({ deletedAt: null, ...CUSTOMER_ORG, name: exact(name, true) });
      if (!org) throw new NotFoundException('Заказчик не найден');
      _id = org._id as Types.ObjectId;
    } else {
      _id = this.oid(id);
      if (!(await this.db.collection('organizations').findOne({ _id, deletedAt: null }))) throw new NotFoundException('Контрагент не найден');
      const [asSupplier, asCompany, orders] = await Promise.all([
        this.db.collection('supplyrequests').countDocuments({ supplierId: _id, deletedAt: null }),
        this.db.collection('supplyrequests').countDocuments({ companyId: _id, deletedAt: null }),
        this.db.collection('salesorders').countDocuments({ companyId: _id, deletedAt: null }),
      ]);
      const used = [asSupplier && `${asSupplier} заявк. как поставщик`, asCompany && `${asCompany} заявк. на компанию`, orders && `${orders} заказ.`].filter(Boolean);
      if (used.length) throw new ConflictException(`Используется: ${used.join(', ')} — удалить нельзя. Дубль — «Объединить с…»`);
      // общая база с CRM kppdf: любая другая таблица со ссылкой на организацию — тоже запрет
      const or = ORG_REF_FIELDS.map((f) => ({ [f]: _id }));
      for (const c of await this.db.listCollections({}, { nameOnly: true }).toArray()) {
        if (['organizations', 'auditlogs'].includes(c.name) || c.name.startsWith('system.')) continue;
        if (await this.db.collection(c.name).findOne({ $or: or }, { projection: { _id: 1 } })) throw new ConflictException(`На контрагента ссылаются записи («${c.name}») — удалить нельзя`);
      }
    }
    await this.db.collection('organizations').updateOne({ _id }, { $set: { deletedAt: new Date(), editedInApp: true } });
    return { id, orgId: String(_id), deleted: true };
  }

  /** Восстановить из корзины: id — организация (ObjectId). */
  async restore(id: string) {
    const _id = this.oid(id);
    const o = await this.db.collection('organizations').findOne({ _id, deletedAt: { $ne: null }, mergedInto: { $exists: false } });
    if (!o) throw new NotFoundException('В корзине такого нет (или он объединён с другим)');
    if (realInn(o.inn) && (await this.db.collection('organizations').findOne({ inn: o.inn, deletedAt: null }))) throw new ConflictException(`ИНН ${o.inn} уже у другого контрагента`);
    await this.db.collection('organizations').updateOne({ _id }, { $set: { deletedAt: null, updatedAt: new Date() } });
    const isCust = !o.isOurCompany && Array.isArray(o.type) && o.type.includes('customer') && !o.type.includes('supplier');
    return this.get(isCust ? CUST + String(o.name) : String(_id));
  }

  /** Корзина: удалённые контрагенты (объединённые дубли не показываем — их данные уже у другого). */
  private async trash() {
    const docs = await this.db.collection('organizations').find({ deletedAt: { $ne: null }, mergedInto: { $exists: false } }).sort({ deletedAt: -1 }).limit(100).toArray();
    const items = docs.map((o) => ({ id: String(o._id), name: String(o.name), inn: realInn(o.inn), deletedAt: o.deletedAt,
      kind: o.isOurCompany ? 'our' : Array.isArray(o.type) && o.type.includes('customer') && !o.type.includes('supplier') ? 'customer' : 'supplier' }));
    return { items, total: items.length, page: 1, limit: 100 };
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
    // ЗЧ.3: и текст «Заказчик» в заявках (orderLabel), и карточка-контрагент (переименовать или, если у цели своя, — в корзину)
    const [a, b, c] = await Promise.all([
      this.db.collection('salesorders').updateMany({ customer: re }, { $set: { customer: to, updatedAt: new Date() } }),
      this.db.collection('incomes').updateMany({ customer: re }, { $set: { customer: to, editedInApp: true } }),
      this.db.collection('supplyrequests').updateMany({ orderLabel: re }, { $set: { orderLabel: to, editedInApp: true } }),
    ]);
    const [fromOrg, toOrg] = await Promise.all([
      this.db.collection('organizations').findOne({ deletedAt: null, ...CUSTOMER_ORG, name: exact(from, true) }),
      this.db.collection('organizations').findOne({ deletedAt: null, ...CUSTOMER_ORG, name: exact(to, true) }),
    ]);
    if (fromOrg && toOrg && String(fromOrg._id) !== String(toOrg._id)) await this.db.collection('organizations').updateOne({ _id: fromOrg._id }, { $set: { deletedAt: new Date(), mergedInto: toOrg._id } });
    else if (fromOrg && !toOrg) await this.db.collection('organizations').updateOne({ _id: fromOrg._id }, { $set: { name: to, updatedAt: new Date(), editedInApp: true } });
    if (!a.matchedCount && !b.matchedCount && !c.matchedCount && !fromOrg) throw new NotFoundException('Заказчик не найден');
    return a.modifiedCount + b.modifiedCount + c.modifiedCount;
  }

  private oid(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id контрагента');
    return new Types.ObjectId(id);
  }
}
