import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { normText } from '../supply/org-resolver';
import type { IncomeDto } from './dto';
import { Income, IncomeDocument, incomeDerived } from './income.schema';

const INCOME_SORT = ['orderNo', 'customer', 'title', 'qty', 'unitPrice', 'amount', 'shipDate', 'paidDate', 'reportDate', 'createdAt', 'updatedAt', 'deletedAt'];
const TEXT = ['orderNo', 'customer', 'paymentForm', 'title', 'unit', 'kind', 'color', 'notes'] as const;
const NUM = ['qty', 'unitPrice', 'amountManual'] as const;

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
    return docs.map((d) => ({
      ...d,
      id: String(d._id), _id: String(d._id),
      companyName: d.companyId ? name.get(String(d.companyId)) ?? null : null,
      /** paid — оплачено; awaiting — отгружено, ждём оплату; draft — ещё не отгружено. */
      status: d.paidDate ? 'paid' : d.shipDate ? 'awaiting' : 'draft',
    }));
  }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: INCOME_SORT, defaultSort: '-reportDate', defaultLimit: 25 });
    const filter: Record<string, unknown> = { deletedAt: p.deleted ? { $ne: null } : null };
    if (q.companyId) filter.companyId = { $in: oids(q.companyId) };
    if (q.orderNo) filter.orderNo = String(q.orderNo);
    const range = dateRange(q.from, q.to);
    if (range) filter.reportDate = range;
    if (p.search) filter.$or = ['orderNo', 'customer', 'title', 'notes', 'kind', 'color'].map((f) => ({ [f]: p.search }));
    const statusCond: Record<string, Record<string, unknown>> = {
      paid: { paidDate: { $ne: null } },
      awaiting: { paidDate: null, shipDate: { $ne: null } },
      draft: { paidDate: null, shipDate: null },
    };
    const full = { ...filter, ...(q.status && statusCond[String(q.status)] ? statusCond[String(q.status)] : {}) };
    const [docs, total, agg, counts] = await Promise.all([
      this.model.find(full).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, orderNo: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(full).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: full }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).exec(),
      Promise.all(Object.entries(statusCond).map(async ([k, c]) => [k, await this.model.countDocuments({ ...filter, ...c }).setOptions({ includeSoftDeleted: true }).exec()] as const)),
    ]);
    const byStatus = Object.fromEntries(counts) as Record<string, number>;
    return {
      items: await this.present(docs as Array<Record<string, unknown>>), total, page: p.page, limit: p.limit,
      sum: agg[0]?.sum ?? 0, counts: { all: byStatus.paid + byStatus.awaiting + byStatus.draft, ...byStatus },
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
    const { amount, reportDate } = this.derive(cur as Record<string, unknown>, f);
    const set: Record<string, unknown> = { amount, editedInApp: true }, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(f)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    if (reportDate) set.reportDate = reportDate; else unset.reportDate = '';
    await this.model.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
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
    const lists = ((await this.connection.db!.collection('settings').findOne({ key: 'supply.sheetLists' }))?.value ?? {}) as Record<string, string[] | undefined>;
    const [companies, customers, forms] = await Promise.all([
      ourCompanies(this.connection),
      this.model.distinct('customer', { deletedAt: null }).exec(),
      this.model.distinct('paymentForm', { deletedAt: null }).exec(),
    ]);
    const sort = (a: unknown[]) => a.filter(Boolean).map(String).sort((x, y) => x.localeCompare(y, 'ru'));
    return { companies: companies.map((c) => ({ id: String(c.id), name: c.name })), customers: sort([...customers, ...(lists.customers ?? [])]).filter((v, i, a) => a.indexOf(v) === i), paymentForms: sort(['б/р', 'нал', ...forms]).filter((v, i, a) => a.indexOf(v) === i) };
  }
}
