import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { customerNames } from '../partners/customer-names';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { tokensFilter } from '../../common/text/search-norm';
import { normText } from '../../common/text/norm-text';
import { sameKey } from '../../common/text/same-text';
import { ourProductLabel, productShortName, type Named } from '../../common/catalog/names';
import { productNameKey, shortProductName } from '../showcase/order-product-name';
import type { IncomeDto } from './dto';
import { Income, IncomeDocument, incomeDerived } from './income.schema';

const INCOME_SORT = ['lineNo', 'orderNo', 'customer', 'title', 'qty', 'unitPrice', 'amount', 'shipDate', 'paidDate', 'reportDate', 'createdAt', 'updatedAt', 'deletedAt'];
const TEXT = ['orderNo', 'customer', 'paymentForm', 'title', 'unit', 'kind', 'color', 'size', 'notes'] as const;
const NUM = ['qty', 'unitPrice', 'amountManual'] as const;
/** Поля шапки заказа, продублированные в позиции (кэш; истина — salesorders). */
const HEADER_CACHE = ['orderNo', 'customer', 'companyId', 'paymentForm', 'shipDate'] as const;

/** Наши компании (organizations.isOurCompany): название → id. Для доходов новые «наши компании» не создаются. */
export async function ourCompanies(connection: Connection) {
  const docs = await connection.db!.collection('organizations').find({ deletedAt: null, isOurCompany: true }, { projection: { name: 1, shortName: 1 } }).toArray();
  return docs.map((d) => ({ id: d._id as Types.ObjectId, name: String(d.shortName || d.name), full: String(d.name) }));
}

/**
 * Доходы (строки заказов). Список с суммой и счётчиками «ждут оплаты / оплачено»; amount и reportDate
 * пересчитываются при каждой записи (income.schema `incomeDerived`).
 */
@Injectable()
export class IncomesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Income.name) private readonly model: Model<IncomeDocument>,
  ) {}

  private async present(docs: Array<Record<string, unknown>>) {
    const companies = await ourCompanies(this.connection);
    const name = new Map(companies.map((c) => [String(c.id), c.name]));
    // Фото позиции (из Excel «Вид»): { url, thumb } — галерея в карточке позиции
    const ids = docs.flatMap((d) => (d.photoIds as Types.ObjectId[] | undefined) ?? []);
    const coll = this.connection.db!.collection('photos');
    const [orig, th] = ids.length ? await Promise.all([
      coll.find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      coll.find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]) : [[], []];
    const url = new Map(orig.map((p) => [String(p._id), String(p.storageUrl)]));
    const thumb = new Map(th.map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
    // название изделия из «Продукции» — для ссылки в карточке позиции (БЗ-5)
    const pids = [...new Set(docs.map((d) => d.productId).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const prods = pids.length ? await this.connection.db!.collection('products').find({ _id: { $in: pids } }, { projection: { name: 1, sku: 1, fullName: 1, orderName: 1 } }).toArray() : [];
    // ТИ-8: name — короткое по цепочке Н-2; ourName — «sku · name» для строки «Наше: …»
    const prod = new Map(prods.map((p) => [String(p._id), { id: String(p._id), name: productShortName(p as Named), sku: (p.sku as string) ?? null, ourName: ourProductLabel(p as Named) }]));
    return docs.map((d) => ({
      ...d,
      photos: ((d.photoIds as Types.ObjectId[] | undefined) ?? []).filter((p) => url.has(String(p))).map((p) => ({ id: String(p), url: url.get(String(p)), thumb: thumb.get(String(p)) ?? url.get(String(p)) })),
      id: String(d._id), _id: String(d._id),
      companyName: d.companyId ? name.get(String(d.companyId)) ?? null : null,
      product: d.productId ? prod.get(String(d.productId)) ?? null : null,
      /** paid — оплачено; awaiting — отгружено, ждём оплату; draft — ещё не отгружено. */
      status: d.paidDate ? 'paid' : d.shipDate ? (Number(d.amount) > 0 ? 'awaiting' : 'noamount') : 'draft',
    }));
  }

  /** money=false (роль без прав на деньги): период и порядок по умолчанию — по дате отгрузки, не по «дате в отчёт» (= дате оплаты). */
  async list(q: Record<string, unknown> = {}, money = true) {
    const p = parseList(q, { sortable: INCOME_SORT, defaultSort: money ? '-reportDate' : '-shipDate', defaultLimit: 25 });
    const filter: Record<string, unknown> = { deletedAt: p.deleted ? { $ne: null } : null };
    if (q.companyId) filter.companyId = { $in: oids(q.companyId) };
    if (q.orderNo) filter.orderNo = String(q.orderNo);
    if (q.orderId) filter.orderId = { $in: oids(q.orderId) };
    const range = dateRange(q.from, q.to);
    if (range) filter[money ? 'reportDate' : 'shipDate'] = range;
    // поиск «как на складе»; в $and — чтобы статус «Без суммы» (свой $or) не затирал поиск
    const sf = tokensFilter(q.search, ['orderNo', 'customer', 'title', 'notes', 'kind', 'color']);
    if (sf) filter.$and = sf.$and;
    const statusCond: Record<string, Record<string, unknown>> = {
      paid: { paidDate: { $ne: null } },
      // «Ждём оплату» — только с суммой; отгружено без суммы (позиции из Excel без цен) — «Без суммы», в оплату не просится
      awaiting: { paidDate: null, shipDate: { $ne: null }, amount: { $gt: 0 } },
      noamount: { paidDate: null, shipDate: { $ne: null }, $or: [{ amount: null }, { amount: { $lte: 0 } }] },
      draft: { paidDate: null, shipDate: null },
    };
    // «отгружено» без деталей оплаты — для ролей без денег (MoneyMask заменяет paid/awaiting/noamount); в счётчики не входит
    const shippedCond = { shipDate: { $ne: null } };
    const full = { ...filter, ...(q.status === 'shipped' ? shippedCond : q.status && statusCond[String(q.status)] ? statusCond[String(q.status)] : {}) };
    const [docs, total, agg, counts] = await Promise.all([
      this.model.find(full).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, orderNo: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(full).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: full }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).exec(),
      Promise.all(Object.entries(statusCond).map(async ([k, c]) => [k, await this.model.countDocuments({ ...filter, ...c }).setOptions({ includeSoftDeleted: true }).exec()] as const)),
    ]);
    const byStatus = Object.fromEntries(counts) as Record<string, number>;
    return {
      items: await this.present(docs as Array<Record<string, unknown>>), total, page: p.page, limit: p.limit,
      sum: agg[0]?.sum ?? 0, counts: { all: byStatus.paid + byStatus.awaiting + byStatus.noamount + byStatus.draft, ...byStatus },
    };
  }

  async get(id: string) {
    const doc = await this.model.findOne({ _id: oid(id, 'дохода'), deletedAt: null }).lean().exec();
    if (!doc) throw new NotFoundException('Запись дохода не найдена');
    return (await this.present([doc as Record<string, unknown>]))[0];
  }

  /** Поля формы → поля схемы; undefined в результате = очистить поле. */
  private async toFields(dto: IncomeDto): Promise<Record<string, unknown>> {
    const f: Record<string, unknown> = {};
    for (const k of TEXT) if (dto[k] !== undefined) f[k] = String(dto[k] ?? '').trim() || undefined;
    for (const k of NUM) if (dto[k] !== undefined) f[k] = dto[k] === null ? undefined : Number(dto[k]);
    for (const k of ['shipDate', 'paidDate'] as const) {
      if (dto[k] === undefined) continue;
      const d = parseSheetDate(dto[k]);
      if (dto[k] && !d) throw new BadRequestException(`${k === 'shipDate' ? 'Дата отгрузки' : 'Дата оплаты'} — в формате ДД.ММ.ГГГГ`);
      f[k] = d;
    }
    if (dto.lineNo !== undefined) f.lineNo = dto.lineNo === null ? undefined : Number(dto.lineNo);
    if (dto.orderId !== undefined) f.orderId = dto.orderId ? oid(dto.orderId, 'заказа') : undefined;
    if (dto.productId !== undefined) f.productId = dto.productId ? oid(dto.productId, 'изделия') : undefined;
    if (dto.companyId) f.companyId = new Types.ObjectId(dto.companyId);
    else if (dto.companyName !== undefined) {
      const name = normText(dto.companyName);
      if (!name) f.companyId = undefined;
      else {
        const hit = (await ourCompanies(this.connection)).find((c) => normText(c.name) === name || normText(c.full) === name);
        if (!hit) throw new BadRequestException(`Наша компания «${dto.companyName}» не найдена — выберите из списка`);
        f.companyId = hit.id;
      }
    }
    return f;
  }

  /**
   * Позиция заказа: поля шапки (№, заказчик, компания, форма оплаты, отгрузка) — из salesorders, а не из формы.
   * Применяется, когда позицию привязывают к заказу или правят её поля шапки.
   */
  private async applyHeader(f: Record<string, unknown>, orderId: unknown) {
    if (!orderId) return;
    const h = await this.connection.db!.collection('salesorders').findOne({ _id: orderId as Types.ObjectId, deletedAt: null });
    if (!h) throw new BadRequestException('Заказ не найден — выберите из списка');
    for (const k of HEADER_CACHE) f[k] = h[k] ?? undefined;
  }

  /** Изделие «Продукции» с тем же коротким названием (как «Из заказов») — привязать новую позицию сразу. */
  private async productByTitle(title: string): Promise<Types.ObjectId | undefined> {
    const key = productNameKey(shortProductName(title));
    if (!key) return undefined;
    const prods = await this.connection.db!.collection('products').find({ deletedAt: null }, { projection: { name: 1 } }).toArray();
    return prods.find((p) => productNameKey(String(p.name ?? '')) === key)?._id as Types.ObjectId | undefined;
  }

  /** Пересчитать amount/reportDate по итоговому состоянию записи. */
  private derive(cur: Record<string, unknown>, f: Record<string, unknown>) {
    const pick = <T>(k: string) => (k in f ? f[k] : cur[k]) as T;
    return incomeDerived({ qty: pick('qty'), unitPrice: pick('unitPrice'), amountManual: pick('amountManual'), shipDate: pick('shipDate'), paidDate: pick('paidDate') });
  }

  async create(dto: IncomeDto, userId?: string) {
    if (dto.clientUid) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id));
    }
    const f = await this.toFields(dto);
    if (!f.title) throw new BadRequestException('Укажите наименование');
    if (dto.productId === undefined) f.productId = await this.productByTitle(String(f.title));
    if (f.orderId) {
      await this.applyHeader(f, f.orderId);
      if (f.lineNo === undefined) {
        const last = await this.model.findOne({ orderId: f.orderId, deletedAt: null }).sort({ lineNo: -1 }).lean().exec();
        f.lineNo = (last?.lineNo ?? 0) + 1;
      }
    }
    const { amount, reportDate } = this.derive({}, f);
    const doc = await this.model.create({
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
      amount, reportDate, clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    });
    return this.get(String(doc._id));
  }

  async update(id: string, dto: IncomeDto) {
    const cur = await this.model.findOne({ _id: oid(id, 'дохода'), deletedAt: null }).lean().exec();
    if (!cur) throw new NotFoundException('Запись дохода не найдена');
    const f = await this.toFields(dto);
    if ('title' in f && !f.title) throw new BadRequestException('Наименование не может быть пустым');
    const orderId = 'orderId' in f ? f.orderId : cur.orderId;
    if (orderId && ('orderId' in f || HEADER_CACHE.some((k) => k in f) || dto.companyName !== undefined)) await this.applyHeader(f, orderId);
    const { amount, reportDate } = this.derive(cur as Record<string, unknown>, f);
    // Оплата без суммы бессмысленна (так строка «оплачена» на 0 ₽) — сначала сумма
    if (f.paidDate && !(amount > 0)) throw new BadRequestException('Сначала впишите сумму (цену за единицу или сумму строки), потом отмечайте оплату');
    const set: Record<string, unknown> = { amount, editedInApp: true }, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(f)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    if (reportDate) set.reportDate = reportDate; else unset.reportDate = '';
    await this.model.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    return this.get(id);
  }

  async addPhoto(id: string, photoId: string) {
    const _id = oid(id, 'позиции'); const pid = oid(photoId, 'фото');
    if (!(await this.connection.db!.collection('photos').findOne({ _id: pid }))) throw new NotFoundException('Фото не найдено — загрузите ещё раз');
    const res = await this.model.updateOne({ _id, deletedAt: null }, { $addToSet: { photoIds: pid }, $set: { editedInApp: true } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Позиция не найдена');
    return this.get(id);
  }

  async removePhoto(id: string, photoId: string) {
    const _id = oid(id, 'позиции'); const pid = oid(photoId, 'фото');
    const res = await this.model.updateOne({ _id, deletedAt: null }, { $pull: { photoIds: pid }, $set: { editedInApp: true } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Позиция не найдена');
    return this.get(id);
  }

  async remove(id: string) {
    const res = await this.model.updateOne({ _id: oid(id, 'дохода'), deletedAt: null }, { $set: { deletedAt: new Date(), editedInApp: true } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Запись дохода не найдена');
    return { id, deleted: true };
  }

  async restore(id: string) {
    const res = await this.model.updateOne({ _id: oid(id, 'дохода'), deletedAt: { $ne: null } }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    if (!res.matchedCount) throw new NotFoundException('Записи нет в корзине');
    return this.get(id);
  }

  /** Подсказки формы: наши компании, заказчики и формы оплаты, которые уже встречались. */
  async lookups() {
    const [companies, customers, forms, dict] = await Promise.all([
      ourCompanies(this.connection),
      customerNames(this.connection.db!), // ЗЧ.1: один источник «Заказчики»
      this.model.distinct('paymentForm', { deletedAt: null }).exec(),
      this.connection.db!.collection('dict_values').find({ dict: 'paymentForms', deletedAt: null }, { projection: { name: 1 } }).toArray(), // SPR-2: справочник «Формы оплаты»
    ]);
    // справочник первым (его написание главнее), затем встреченные в данных; «б/р», «нал» — пока справочник пуст; дубли разного написания схлопываются
    const seen = new Set<string>();
    const paymentForms = [...dict.map((d) => d.name), ...(dict.length ? [] : ['б/р', 'б/р 30%', 'б/р 50%', 'нал']), ...forms]
      .map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()).filter((v) => v && !seen.has(sameKey(v)) && seen.add(sameKey(v)))
      .sort((x, y) => x.localeCompare(y, 'ru'));
    return { companies: companies.map((c) => ({ id: String(c.id), name: c.name })), customers, paymentForms };
  }
}
