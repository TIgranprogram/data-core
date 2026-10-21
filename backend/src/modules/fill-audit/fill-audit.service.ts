import { Injectable } from '@nestjs/common';
import { decideArticle } from '../stock/article';
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
    const ppLive = { deletedAt: null };
    const ppItem = (r: Q): Item => ({ id: String(r._id), title: `№${r.passportNumber ?? ''} · ${String(r.name ?? '') || 'без названия'}`, sub: [r.date ? dmy(r.date) : '', r.customerName || r.objectName].filter(Boolean).join(' · ') });
    const defs: Def[] = [
      // ── Паспорта изделий (ПС.4): без этого паспорт нельзя выдать (PDF неполный) ──
      { key: 'pp-name', area: 'Паспорта', title: 'Паспорт без наименования', why: 'Наименование — на титуле, в талоне и в описании', section: 'passports', field: 'name', money: false,
        coll: 'productpassports', q: { ...ppLive, ...empty('name') }, item: ppItem, sort: { passportNo: -1 } },
      { key: 'pp-category', area: 'Паспорта', title: 'Паспорт без категории', why: 'Фильтр и отчёты по категориям', section: 'passports', field: 'category', money: false,
        coll: 'productpassports', q: { ...ppLive, ...empty('category') }, item: ppItem, sort: { passportNo: -1 } },
      { key: 'pp-overview', area: 'Паспорта', title: 'Нет картинки общего вида', why: 'Общий вид — на титуле паспорта', section: 'passports', field: 'img_overview', money: false,
        coll: 'productpassports', q: { ...ppLive, 'images.kind': { $ne: 'overview' } }, item: ppItem, sort: { passportNo: -1 } },
      { key: 'pp-supplier', area: 'Паспорта', title: 'Поставщик — не наша компания', why: 'Реквизиты, печать и подпись в PDF берутся из организации-поставщика', section: 'passports', field: 'supplierOrgId', money: false,
        coll: 'productpassports', q: { ...ppLive, ...empty('supplierOrgId') }, item: ppItem, sort: { passportNo: -1 } },
      { key: 'pp-dims', area: 'Паспорта', title: 'Нет габаритов или веса', why: 'Таблица 1 «Основные технические данные»', section: 'passports', field: 'height', money: false,
        coll: 'productpassports', q: { ...ppLive, $or: [{ height: null }, { height: { $exists: false } }, { weight: null }, { weight: { $exists: false } }] }, item: ppItem, sort: { passportNo: -1 } },
      { key: 'pp-materials', area: 'Паспорта', title: 'Нет материалов, установки или назначения', why: 'Раздел 1 «Описание»', section: 'passports', field: 'materials', money: false,
        coll: 'productpassports', q: { ...ppLive, $or: [empty('materials'), empty('installationMethod'), empty('purpose')] }, item: ppItem, sort: { passportNo: -1 } },
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
    if (!opts.only || opts.only === 'mat-article') { const g = await this.articleGroup(limit); if (g) groups.push(g); }
    return { total: groups.reduce((s, g) => s + g.count, 0), groups };
  }

  /**
   * АР.3: у позиции склада артикул не тот, что в заявке на неё (по связи materialId): автоартикул СКЛ-… вместо настоящего,
   * свой другой или этот артикул уже у другой позиции. Не меняем молча — показываем; «Заполнить» открывает поле «Артикул».
   */
  private async articleGroup(limit: number): Promise<FillGroup | null> {
    const db = this.connection.db!;
    const reqs = await db.collection('supplyrequests').aggregate([
      { $match: { deletedAt: null, materialId: { $ne: null }, article: { $nin: [null, ''] } } },
      { $sort: { requestDate: -1 } },
      { $group: { _id: '$materialId', article: { $first: '$article' }, num: { $first: '$num' } } },
    ]).toArray();
    if (!reqs.length) return null;
    const mats = await db.collection('materials').find({ _id: { $in: reqs.map((r) => r._id) }, deletedAt: null }, { projection: { name: 1, article: 1 } }).toArray();
    const all = await db.collection('materials').find({ deletedAt: null, article: { $nin: [null, ''] } }, { projection: { article: 1 } }).toArray();
    const owner = new Map(all.map((m) => [String(m.article).trim().toLowerCase(), String(m._id)]));
    const req = new Map(reqs.map((r) => [String(r._id), r]));
    const items: Item[] = [];
    for (const m of mats) {
      const r = req.get(String(m._id))!;
      const o = owner.get(String(r.article).trim().toLowerCase());
      const d = decideArticle(m.article, r.article, !!o && o !== String(m._id));
      if (d === 'same' || d === 'skip') continue;
      const why = d === 'set' ? 'артикул не перенесён' : d === 'duplicate' ? 'этот артикул уже у другой позиции' : 'у позиции другой';
      items.push({ id: String(m._id), title: String(m.name ?? ''), sub: `в заявке${r.num ? ' №' + r.num : ''}: ${r.article} · сейчас: ${m.article || '—'} · ${why}` });
    }
    if (!items.length) return null;
    return { key: 'mat-article', area: 'Склад', title: 'Артикул в заявке другой', why: 'Артикул поставщика из заявки не совпадает с позицией склада (или у позиции внутренний код СКЛ-…) — проверьте и впишите верный', section: 'stock', field: 'article', money: false,
      count: items.length, items: items.slice(0, limit) };
  }
}
