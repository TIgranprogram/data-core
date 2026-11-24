import { archiveOrderConflict, claimWritableOrders, withOrderWrite } from '../../common/order-archive/write';
import { confirmOrderLineProduct, restoreLinesDeletedWithOrder, softDeleteLinesWithOrder, syncOrderHeaderCache } from '../incomes/income-writes';
import { loadOrderMatches } from '../matching/match-facts';
import { LegalPatchDto } from '../../common/legal/legal.dto';
import { assertIntakeIndexes, assertSalesBusinessIndex, assertIntakeReplay, intakeContentHash, intakeBusinessKey, legalHash, legalPresentation, legalSummary, patchLegal, prepareLegal, validateLegalFiles, validateLegalParties } from '../../common/legal/legal-utils';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { tokensFilter } from '../../common/text/search-norm';
import { ourCompanies } from '../../common/our-companies';
import { normText } from '../../common/text/norm-text';
import { ZonesService } from '../zones/zones.service';
import type { SalesOrderDto } from './dto';
import { ACTIVE_STAGES, DONE_STAGES, ORDER_STAGES, STAGE_LABELS, orderKey, type OrderStage } from '../../common/text/order-key';
import { netIssuedByLine } from '../../common/issued-net';
import { remaining } from '../../common/text/shipment-calc';
import { loadLinePhotos, type LinePhoto } from '../../common/photos';
import { HISTORY_TYPES, loadOrderHistory, type HistoryAccess } from './order-history';
import { ORDER_PRIORITIES, type OrderPriority } from '../../common/text/order-key';
import { loadSeq } from '../../common/text/production-seq';
import { dayOf, leadDays } from '../../common/work-schedule';
import { suggestProducts } from '../../common/catalog/product-match';
import { isUnassigned } from '../matching/matching-rules';
import { SalesOrder, SalesOrderDocument } from './sales-order.schema';

type Doc = Record<string, unknown>;
const SORT = ['orderNo', 'productionNo', 'customer', 'stage', 'shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate', 'createdAt', 'updatedAt', 'deletedAt', 'priority'];
const TEXT = ['orderNo', 'customer', 'title', 'paymentForm', 'contractNo', 'productionNo', 'notes'] as const;
/** Порядок «срочные сверху»: нет приоритета = обычный. */
/** Mongo-выражение «Не распределена» (то же, что isUnassigned): нет изделия, не услуга и не «не изделие». */
export const UNASSIGNED = { $and: [{ $eq: [{ $ifNull: ['$productId', null] }, null] }, { $ne: [{ $ifNull: ['$lineType', ''] }, 'service'] }, { $ne: [{ $ifNull: ['$matchStatus', ''] }, 'none'] }] };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const DATES = [['contractDate', 'Дата контракта'], ['shipDate', 'Дата отгрузки'], ['productionDeadline', 'Срок изготовления'], ['deliveryDeadline', 'Окончание поставки']] as const;

/** Следующий № на производство: max N среди «N-ГГ» этого года + 1 (yy — две цифры года). */
export function nextProductionNo(nos: Array<string | undefined | null>, yy: string): string {
  let max = 0;
  for (const v of nos) { const m = /^(\d+)-(\d{2})$/.exec(String(v ?? '').trim()); if (m && m[2] === yy) max = Math.max(max, Number(m[1])); }
  return `${max + 1}-${yy}`;
}

/**
 * Заказы заказчиков (TASKS З.1): шапка в `salesorders`, позиции — `incomes` с orderId.
 * Карточка (`get`) собирает позиции, заявки снабжения и движения склада, привязанные к заказу.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesOrder.name) private readonly model: Model<SalesOrderDocument>,
    @Optional() private readonly zones?: ZonesService,
  ) {}

  private incomes() { return this.connection.db!.collection('incomes'); }

  private async present(docs: Doc[]) {
    const companies = await ourCompanies(this.connection);
    const name = new Map(companies.map((c) => [String(c.id), c.name]));
    // сводка по позициям: сколько строк, на какую сумму и сколько оплачено
    const ids = docs.map((d) => d._id as Types.ObjectId);
    const agg = ids.length ? await this.incomes().aggregate([
      { $match: { orderId: { $in: ids }, deletedAt: null, cancelledAt: null } },
      { $group: { _id: '$orderId', lines: { $sum: 1 }, unassigned: { $sum: { $cond: [UNASSIGNED, 1, 0] } }, amount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $ifNull: ['$paidDate', false] }, '$amount', { $ifNull: ['$paidAmount', 0] }] } } } },
    ]).toArray() : [];
    const sum = new Map(agg.map((a) => [String(a._id), a]));
    return docs.map((d) => {
      const s = sum.get(String(d._id));
      const stage = (d.stage as OrderStage) || 'new';
      return {
        ...d, legal:undefined, legalHistory:undefined, legalReceipts:undefined, intakeHash:undefined, legalSummary:legalSummary(d.legal as any,Number(s?.unassigned||0)), id: String(d._id), _id: String(d._id),
        offerId: d.offerId ? String(d.offerId) : null,
        companyName: d.companyId ? name.get(String(d.companyId)) ?? null : null,
        stage, stageLabel: STAGE_LABELS[stage] ?? stage,
        lineCount: s?.lines ?? 0, unassignedCount: s?.unassigned ?? 0, amount: s?.amount ?? 0, paidAmount: s?.paid ?? 0,
      };
    });
  }

  /** Фильтры списка заказов (общие с /production-orders): filter — без этапов, stages — список этапов или undefined. */
  filters(q: Record<string, unknown>, deleted = false): { filter: Doc; stages?: string[] } {
    const filter: Doc = { deletedAt: deleted ? { $ne: null } : null };
    if (q.companyId) filter.companyId = { $in: oids(q.companyId) };
    const range = dateRange(q.from, q.to);
    if (range) filter.shipDate = range;
    // dueTo=ГГГГ-ММ-ДД — срок (отгрузка, иначе изготовление, иначе окончание поставки) не позже даты: очередь «Сроки по заказам»
    const due = q.dueTo ? dateRange(undefined, q.dueTo) : null;
    if (due) filter.$and = [{ $or: [{ shipDate: due }, { shipDate: null, productionDeadline: due }, { shipDate: null, productionDeadline: null, deliveryDeadline: due }] }];
    // поиск «как на складе»: каждое слово — в одном из полей (И), ё = е, M10 = М10
    const sf = tokensFilter(q.search, ['orderNo', 'customer', 'title', 'contractNo', 'productionNo', 'notes']);
    if (sf) filter.$and = [...((filter.$and as unknown[]) ?? []), ...sf.$and];
    // этапы: filter=active|done|all или явный список stage=new,production
    let stages: string[] | undefined;
    if (q.filter === 'active') stages = ACTIVE_STAGES;
    else if (q.filter === 'done') stages = DONE_STAGES;
    else if (q.filter === 'shipped' || q.filter === 'closed') stages = [q.filter];
    else if (q.filter && q.filter !== 'all') throw new BadRequestException('Параметр filter: active (в работе), shipped (отгруженные), closed (завершённые), done (отгруженные и завершённые) или all (все)');
    if (q.stage) {
      const want = String(q.stage).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = want.find((s) => !(ORDER_STAGES as readonly string[]).includes(s));
      if (bad) throw new BadRequestException(`Неизвестный этап «${bad}»`);
      stages = stages ? stages.filter((s) => want.includes(s)) : want;
    }
    // priority=urgent,high — приоритет заказа; «normal» включает заказы без приоритета
    if (q.priority) {
      const want = String(q.priority).split(',').map((x) => x.trim()).filter(Boolean);
      const bad = want.find((x) => !(ORDER_PRIORITIES as readonly string[]).includes(x));
      if (bad) throw new BadRequestException(`Неизвестный приоритет «${bad}»: urgent, high, normal или low`);
      filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: [{ priority: { $in: want } }, ...(want.includes('normal') ? [{ priority: null }] : [])] }];
    }
    if(String(q.unassigned)==='1')filter.$and=[...((filter.$and as unknown[])||[]),{$or:[{productionNo:null},{productionNo:''}]}];
    if(String(q.needsReview)==='1')filter['legal.issues']={$elemMatch:{state:{$in:['unknown','conflict']}}};
    return { filter, stages };
  }

  /** КМ1: ?productId= — договоры, у которых есть живая позиция с этим изделием (несколько id через запятую — любое из них). */
  private async byProduct(filter: Doc, productId: unknown) {
    const pids = oids(productId);
    if (!productId) return;
    if (!pids.length) throw new BadRequestException('Некорректный id изделия');
    const ids = await this.connection.db!.collection('incomes').distinct('orderId', { productId: { $in: pids }, deletedAt: null, cancelledAt: null, orderId: { $ne: null } });
    filter.$and = [...((filter.$and as unknown[]) ?? []), { _id: { $in: ids } }];
  }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: SORT, defaultSort: '-createdAt', defaultLimit: 25 });
    const { filter, stages } = this.filters(q, p.deleted);
    await this.byProduct(filter, q.productId);
    const full = { ...filter, ...(stages ? { stage: { $in: stages } } : {}) };
    // № заказа «N-ГГ» — не по алфавиту: год, затем N числом; без № — в конце (Mongo 4.4: $split + $convert)
    const num = (i: number) => ({ $convert: { input: { $arrayElemAt: [{ $split: [{ $ifNull: ['$productionNo', ''] }, '-'] }, i] }, to: 'int', onError: null, onNull: null } });
    const [docs, total, byStage] = await Promise.all([
      'productionNo' in p.sort
        ? this.model.aggregate([{ $match: full }, { $addFields: { _pnone: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$productionNo', ''] } }, 0] }, 0, 1] }, _py: num(1), _pn: num(0) } },
          { $sort: { _pnone: 1, _py: p.sort.productionNo, _pn: p.sort.productionNo, productionNo: p.sort.productionNo, _id: -1 } }, { $skip: p.skip }, { $limit: p.limit }, { $project: { _pnone: 0, _py: 0, _pn: 0, legalHistory:0,legalReceipts:0,intakeHash:0 } }]).exec()
      : 'priority' in p.sort
        // срочность — не по алфавиту: ранг через $switch (Mongo 4.4)
        ? this.model.aggregate([{ $match: full }, { $addFields: { _rank: { $switch: { branches: Object.entries(PRIORITY_RANK).map(([k, v]) => ({ case: { $eq: ['$priority', k] }, then: v })), default: PRIORITY_RANK.normal } } } }, { $sort: { _rank: p.sort.priority, _id: -1 } }, { $skip: p.skip }, { $limit: p.limit }, { $project: { _rank: 0,legalHistory:0,legalReceipts:0,intakeHash:0 } }]).exec()
        : this.model.find(full,{legalHistory:0,legalReceipts:0,intakeHash:0}).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(full).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: filter }, { $group: { _id: '$stage', n: { $sum: 1 } } }]).exec(),
    ]);
    const counts: Record<string, number> = Object.fromEntries(ORDER_STAGES.map((s) => [s, 0]));
    for (const r of byStage) { const k = String(r._id ?? 'new'); counts[k] = (counts[k] ?? 0) + r.n; }
    const n = (ss: readonly string[]) => ss.reduce((a, s) => a + (counts[s] ?? 0), 0);
    return {
      items: await this.present(docs as Doc[]), total, page: p.page, limit: p.limit,
      counts: { all: n(ORDER_STAGES), active: n(ACTIVE_STAGES), done: n(DONE_STAGES), ...counts },
    };
  }

  private async findRaw(id: string, deleted = false) {
    const doc = await this.model.findOne({ _id: oid(id, 'заказа'), deletedAt: deleted ? { $ne: null } : null }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!doc) throw new NotFoundException(deleted ? 'Заказа нет в корзине' : 'Заказ не найден');
    return doc as Doc;
  }

  /**
   * Карточка: шапка + позиции + заявки снабжения и движения склада под этот заказ.
   * SK-8d: see.requests / see.stock = false (раздел закрыт для роли) — заявки / движения и «выдано под позицию» пустые.
   */
  async get(id: string, see: { requests?: boolean; stock?: boolean } = {}) {
    const seeReq = see.requests !== false, seeStock = see.stock !== false;
    const doc = legalPresentation(await this.findRaw(id));
    const _id = doc._id as Types.ObjectId;
    // Привязка — поля data-core salesOrderId (orderId в заявках занят CRM-заказами)
    const db = this.connection.db!;
    const [lines, supplyRequests, stockMovements, reservations] = await Promise.all([
      this.incomes().find({ orderId: _id, deletedAt: null }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray(),
      seeReq ? db.collection('supplyrequests').find({ salesOrderId: _id, deletedAt: null }, { projection: { num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, requestDate: 1, salesOrderLineId: 1, supplierId: 1 } }).sort({ requestDate: -1 }).toArray() : Promise.resolve([] as Doc[]),
      seeStock ? db.collection('stockmovements').find({ salesOrderId: _id, deletedAt: null, cancelledAt: null }, { projection: { type: 1, date: 1, materialId: 1, qty: 1, notes: 1, salesOrderLineId: 1, issuedToPersonId: 1, issuedTo: 1, reservationId: 1, reason: 1, isReturn: 1, cancelOf: 1 } }).sort({ date: -1 }).toArray() : Promise.resolve([] as Doc[]),
      // брони под заказ (TASKS Б.3): активные и выданные, снятые — нет
      db.collection('reservations').find({ salesOrderId: _id, deletedAt: null, status: { $in: ['active', 'fulfilled'] } }, { projection: { batchId: 1, groupName: 1, orderId: 1, materialId: 1, qty: 1, issuedQty: 1, status: 1, createdAt: 1 } }).sort({ createdAt: -1 }).toArray(),
    ]);
    const mats = await db.collection('materials').find({ _id: { $in: [...stockMovements, ...reservations].map((m) => m.materialId).filter(Boolean) } }, { projection: { name: 1, unit: 1 } }).toArray();
    const matName = new Map(mats.map((m) => [String(m._id), m]));
    // кому выдано (TASKS Л.3)
    const pids = stockMovements.map((m) => m.issuedToPersonId).filter(Boolean) as Types.ObjectId[];
    const persons = pids.length ? await db.collection('persons').find({ _id: { $in: pids } }, { projection: { lastName: 1, firstName: 1 } }).toArray() : [];
    const pName = new Map(persons.map((p) => [String(p._id), [p.lastName, p.firstName].filter(Boolean).join(' ')]));
    for (const m of stockMovements as Doc[]) {
      const x = matName.get(String(m.materialId)); m.materialName = x?.name ?? null; m.unit = x?.unit ?? null;
      m.issuedToLabel = [m.issuedToPersonId ? pName.get(String(m.issuedToPersonId)) : null, m.issuedTo].filter(Boolean).join(' · ') || null;
    }
    // «Выдано под позицию» (SK-5): нетто = выдано − возвращено, по позиции заказа и материалу
    const issuedByLine = netIssuedByLine(stockMovements as never).map((r) => ({ ...r, photo: null as LinePhoto, materialName: (matName.get(r.materialId)?.name as string | undefined) ?? null, unit: (matName.get(r.materialId)?.unit as string | undefined) ?? null }));
    const resGroups = new Map<string, { key: string; name: string; createdAt: unknown; lines: number; left: number; issued: number }>();
    for (const r of reservations) {
      const key = String(r.batchId ?? r._id);
      const g = resGroups.get(key) ?? { key, name: String(r.groupName || r.orderId || 'Бронь'), createdAt: r.createdAt, lines: 0, left: 0, issued: 0 };
      g.lines++;
      if (r.status === 'active') g.left += Number(r.qty) || 0;
      g.issued += Number(r.issuedQty ?? (r.status === 'fulfilled' ? r.qty : 0)) || 0;
      resGroups.set(key, g);
    }
    const ST: Record<string, string> = { in_progress: 'Ожидает', requested: 'Заказать', ordered: 'В работе', received: 'Получено', cancelled: 'Отменено' };
    for (const s of supplyRequests as Doc[]) s.statusLabel = s.status === 'ordered' && s.paid ? 'Оплачено' : ST[String(s.status)] ?? s.status;
    // Фото позиции: своё (из Excel «Вид» или загруженное), иначе главное фото изделия, иначе null — превью в карточке заказа
    const linePh = await loadLinePhotos(db, lines);
    for (const l of lines as Doc[]) l.photo = linePh.get(String(l._id)) ?? null;
    for (const r of issuedByLine) r.photo = linePh.get(r.salesOrderLineId) ?? null;
    // Изделие каждой позиции одним $in (образец — incomes.present): {id, name, sku, photoId}; фото — products.photoIds[0], как в витрине
    const prodIds = [...new Set(lines.map((l) => l.productId).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const prods = prodIds.length ? await db.collection('products').find({ _id: { $in: prodIds } }, { projection: { name: 1, sku: 1, photoIds: 1 } }).toArray() : [];
    const prodOf = new Map(prods.map((p) => [String(p._id), { id: String(p._id), name: String(p.name ?? p.sku ?? ''), sku: (p.sku as string | undefined) ?? null, photoId: ((p.photoIds as Types.ObjectId[] | undefined) ?? [])[0] ? String((p.photoIds as Types.ObjectId[])[0]) : null }]));
    for (const l of lines as Doc[]) l.product = l.productId ? prodOf.get(String(l.productId)) ?? null : null;
    // отгрузки (ОТГ): по каждой позиции «отгружено / осталось»; legacyShipped — этап «отгружен» без записей отгрузок (до учёта)
    const ships = await this.connection.db!.collection('shipments').find({ orderId: _id, deletedAt: null }, { projection: { lines: 1 } }).toArray();
    const rem = new Map(remaining((lines as Doc[]).map((l) => ({ id: String(l._id), qty: l.qty as number | undefined })), ships.map((x) => ({ lines: ((x.lines as Array<{ incomeId: unknown; qty: number }>) ?? []).map((y) => ({ incomeId: String(y.incomeId), qty: y.qty })) }))).map((r) => [r.incomeId, r]));
    for (const l of lines as Doc[]) { const r = rem.get(String(l._id)); l.shipped = r?.shipped ?? 0; l.left = r?.left ?? 0; }
    const header = { ...(await this.present([doc]))[0], shipmentCount: ships.length, legacyShipped: doc.stage === 'shipped' && ships.length === 0 };
    const fix = (a: Doc[]) => a.map((x) => ({ ...x, id: String(x._id), _id: String(x._id) }));
    return {
      ...header,legal:doc.legal,legalVersion:doc.legalVersion,legalHistory:doc.legalHistory,readiness:doc.readiness,
      leadDays: await this.orderLeadDays(lines), // срок изготовления по нормам планов позиций (C041 Э3)
      lines: fix(lines.map((l) => ({ ...l, status: l.cancelledAt ? 'cancelled' : l.paidDate ? 'paid' : l.shipDate ? 'awaiting' : 'draft', unassigned: !l.cancelledAt && isUnassigned(l as Doc) }))),
      supplyRequests: fix(supplyRequests), stockMovements: fix(stockMovements), issuedByLine,
      reservations: [...resGroups.values()].map((g) => ({ ...g, left: Math.round(g.left * 1000) / 1000, issued: Math.round(g.issued * 1000) / 1000 })),
    };
  }

  /** Срок изготовления заказа (C041 Э3): самый долгий по позициям, рабочие дни по нормам их планов; нет норм — null. */
  private async orderLeadDays(lines: Doc[]): Promise<number | null> {
    const ids = lines.filter((l) => !l.cancelledAt).map((l) => l._id as Types.ObjectId);
    if (!ids.length) return null;
    const plans = await this.connection.db!.collection('orderlineplans').find({ incomeId: { $in: ids }, deletedAt: null }, { projection: { incomeId: 1, steps: 1 } }).toArray();
    let max = 0;
    for (const p of plans) {
      const inc = lines.find((l) => String(l._id) === String(p.incomeId));
      const qty = Math.max(1, Number(inc?.qty) || 1);
      const steps = ((p.steps as Array<{ _id: unknown; partRowId?: unknown; hours?: number; plan?: { start: Date; end: Date } }>) ?? []).filter((s) => Number(s.hours) > 0);
      if (!steps.length) continue;
      const r = leadDays(steps.map((s) => ({ id: String(s._id), part: s.partRowId ? String(s.partRowId) : null, hours: (Number(s.hours) || 0) * qty, plan: s.plan ? { start: new Date(s.plan.start), end: new Date(s.plan.end) } : null })), dayOf(new Date()));
      max = Math.max(max, r.days);
    }
    return max || null;
  }

  /** `?year=2026` (умолч. текущий) → `{value:"21-26"}`; удалённые заказы номер не освобождают. */
  async nextProductionNo(q: Record<string, unknown> = {}) {
    const year = q.year === undefined || q.year === '' ? new Date().getFullYear() : Number(q.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new BadRequestException('Параметр year — год, например 2026');
    const yy = String(year % 100).padStart(2, '0');
    const docs = await this.model.find({ productionNo: new RegExp(`^\\d+-${yy}$`) }, { productionNo: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
    return { value: nextProductionNo((docs as Doc[]).map((d) => d.productionNo as string), yy) };
  }

  /**
   * SK-8d: короткий список заказов для выбора из соседних разделов (выдача на складе, заявка «под заказ», паспорт) —
   * без денег. filter: active (по умолч.) | all; lines=1 — с позициями (id, lineNo, title, qty, productId).
   */
  async lookup(q: Record<string, unknown> = {}) {
    const f = q.filter ?? 'active';
    // active — в работе; shipped — полностью отгруженные (выдача мелочи с телефона); all — всё
    if (f !== 'active' && f !== 'shipped' && f !== 'all') {
      throw new BadRequestException('Параметр filter: active (в работе), shipped (отгруженные) или all (все)');
    }
    const filter: Doc = {
      deletedAt: null,
      ...(f === 'active' ? { stage: { $in: ACTIVE_STAGES } } : f === 'shipped' ? { stage: 'shipped' } : {}),
    };
    const docs = await this.model.find(filter, { orderNo: 1, productionNo: 1, customer: 1, title: 1, stage: 1, shipDate: 1 }).sort({ createdAt: -1, _id: -1 }).lean().exec();
    const withLines = String(q.lines) === '1';
    const byOrder = new Map<string, Doc[]>();
    const seq = withLines && docs.length ? await loadSeq(this.connection.db!, docs.map((d) => d._id)) : new Map<string, { seqNo: number }>();
    if (withLines && docs.length) {
      const lines = await this.incomes().find({ orderId: { $in: docs.map((d) => d._id) }, deletedAt: null, cancelledAt: null }, { projection: { orderId: 1, lineNo: 1, title: 1, qty: 1, productId: 1, photoIds: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
      const photos = await loadLinePhotos(this.connection.db!, lines);
      for (const l of lines) {
        const list = byOrder.get(String(l.orderId)) ?? [];
        list.push({ id: String(l._id), lineNo: (l.lineNo as number | undefined) ?? null, seqNo: seq.get(String(l._id))?.seqNo ?? null, title: l.title ?? '', qty: (l.qty as number | undefined) ?? null, productId: l.productId ? String(l.productId) : null, photo: photos.get(String(l._id)) ?? null });
        byOrder.set(String(l.orderId), list);
      }
    }
    return {
      items: (docs as Doc[]).map((d) => ({
        id: String(d._id), orderNo: (d.orderNo as string | undefined) ?? null, productionNo: (d.productionNo as string | undefined) ?? null, customer: (d.customer as string | undefined) ?? null,
        title: (d.title as string | undefined) ?? null, stage: (d.stage as string | undefined) || 'new', shipDate: (d.shipDate as Date | undefined) ?? null,
        ...(withLines ? { lines: byOrder.get(String(d._id)) ?? [] } : {}),
      })),
    };
  }

  /**
   * Позиции заказа для выбора при выдаче со склада (SK-5): без цен, с картинкой.
   * photoId — первое фото позиции, иначе главное фото изделия, иначе null.
   */
  async linesLookup(id: string) {
    const order = await this.findRaw(id);
    const db = this.connection.db!;
    const seq = await loadSeq(db, [order._id]);
    const lines = await this.incomes().find({ orderId: order._id, deletedAt: null, cancelledAt: null }, { projection: { lineNo: 1, title: 1, productId: 1, photoIds: 1, qty: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
    const allProdIds = [...new Map(lines.filter((l) => l.productId).map((l) => [String(l.productId), l.productId as Types.ObjectId])).values()];
    const prodInfo = new Map<string, { name?: string; sku?: string; firstPhoto?: Types.ObjectId }>();
    if (allProdIds.length) {
      const pp = await db.collection('products').find({ _id: { $in: allProdIds } }, { projection: { name: 1, sku: 1, photoIds: 1 } }).toArray();
      for (const x of pp) { const first = ((x.photoIds as Types.ObjectId[] | undefined) ?? [])[0]; prodInfo.set(String(x._id), { name: x.name as string | undefined, sku: x.sku as string | undefined, firstPhoto: first }); }
    }
    const photoOf = (l: Doc) => String(((l.photoIds as Types.ObjectId[] | undefined) ?? [])[0] ?? (l.productId ? prodInfo.get(String(l.productId))?.firstPhoto : undefined) ?? '') || null;
    // Превью (thumb) — двумя запросами на весь заказ; нет превью — оригинал
    const pIds = [...new Set(lines.map(photoOf).filter(Boolean) as string[])].map((s) => new Types.ObjectId(s));
    const [ph, th] = pIds.length ? await Promise.all([
      db.collection('photos').find({ _id: { $in: pIds } }, { projection: { storageUrl: 1 } }).toArray(),
      db.collection('photos').find({ parentPhotoId: { $in: pIds }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]) : [[], []];
    const url = new Map(ph.map((p) => [String(p._id), String(p.storageUrl)]));
    for (const p of th) url.set(String(p.parentPhotoId), String(p.storageUrl));
    return lines.map((l) => {
      const photoId = photoOf(l);
      return {
        id: String(l._id), orderNo: (order.orderNo as string | undefined) ?? null, productionNo: (order.productionNo as string | undefined) ?? null, lineNo: (l.lineNo as number | undefined) ?? null, seqNo: seq.get(String(l._id))?.seqNo ?? null, title: l.title ?? '',
        productId: l.productId ? String(l.productId) : null,
        sku: (l.productId ? prodInfo.get(String(l.productId))?.sku : undefined) ?? null,
        productName: (l.productId ? prodInfo.get(String(l.productId))?.name : undefined) ?? null,
        photoId, photoThumb: (photoId && url.get(photoId)) || null,
        qty: (l.qty as number | undefined) ?? null,
      };
    });
  }

  /** Поля формы → поля схемы; undefined = очистить. companyShort: undefined — компанию не меняли, null — убрали. */
  private async toFields(dto: SalesOrderDto): Promise<{ f: Doc; companyShort?: string | null }> {
    const f: Doc = {};
    if(dto.counterpartyId===null)f.counterpartyId=undefined;
    if(dto.counterpartyId){const customer=await this.connection.db!.collection('organizations').findOne({_id:oid(dto.counterpartyId,'контрагента'),deletedAt:null},{projection:{_id:1}});if(!customer)throw new BadRequestException('Контрагент не найден');f.counterpartyId=customer._id;}
    for (const k of TEXT) if (dto[k] !== undefined) f[k] = String(dto[k] ?? '').trim() || undefined;
    for (const [k, label] of DATES) {
      if (dto[k] === undefined) continue;
      const d = parseSheetDate(dto[k]);
      if (dto[k] && !d) throw new BadRequestException(`${label} — в формате ДД.ММ.ГГГГ`);
      f[k] = d;
    }
    if (dto.stage !== undefined) f.stage = dto.stage;
    if (dto.responsibleId !== undefined) {
      if (!dto.responsibleId) f.responsibleId = undefined;
      else {
        const pid = Types.ObjectId.isValid(dto.responsibleId) ? new Types.ObjectId(dto.responsibleId) : null;
        if (!pid || !(await this.connection.db!.collection('persons').findOne({ _id: pid, deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException('Ответственный — выберите сотрудника из списка');
        f.responsibleId = pid;
      }
    }
    if (dto.priority !== undefined) f.priority = (dto.priority as OrderPriority | '') || undefined;
    if (dto.offerId !== undefined) f.offerId = dto.offerId ? oid(dto.offerId, 'КП') : undefined;
    if (dto.offerNo !== undefined) f.offerNo = String(dto.offerNo ?? '').trim() || undefined;
    let companyShort: string | null | undefined;
    if (dto.companyId || dto.companyName !== undefined) {
      const ours = await ourCompanies(this.connection);
      const name = normText(dto.companyName);
      if (!dto.companyId && !name) { f.companyId = undefined; companyShort = null; } else {
        const hit = dto.companyId ? ours.find((c) => String(c.id) === dto.companyId) : ours.find((c) => normText(c.name) === name || normText(c.full) === name);
        if (!hit) throw new BadRequestException(`Наша компания${dto.companyName ? ` «${dto.companyName}»` : ''} не найдена — выберите из списка`);
        f.companyId = hit.id; companyShort = hit.name;
      }
    }
    return { f, companyShort };
  }

  private async companyShort(companyId: unknown): Promise<string> {
    if (!companyId) return '';
    return (await ourCompanies(this.connection)).find((c) => String(c.id) === String(companyId))?.name ?? '';
  }

  /** Другой действующий заказ с тем же «компания|номер» (по ключу или по текущим полям). */
  private async clash(key: string, exceptId?: Types.ObjectId, strictUnknown=false) {
    const byKey = await this.model.findOne({ importKey: key, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (byKey) return byKey;
    const no = key.slice(key.indexOf('|') + 1);
    const cands = await this.model.find({ ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { orderNo: 1, companyId: 1,deletedAt:1 }).setOptions({includeSoftDeleted:true}).lean().exec();
    for (const c of cands)if(orderKey('',c.orderNo).slice(1)===no){const company=await this.companyShort(c.companyId);if(strictUnknown&&!company)return c;if(orderKey(company,c.orderNo)===key)return c;}
    return null;
  }

  /** Форма приложения (`requireFields`): договор без № заказа, заказчика или нашей компании не сохраняется. При правке — с учётом прежних значений. */
  private checkRequired(f: Doc, cur?: Doc) {
    const val = (k: string) => (k in f ? f[k] : cur?.[k]);
    const miss = [['orderNo', '№ договора'], ['productionNo', '№ заказа'], ['customer', 'заказчик'], ['companyId', 'наша компания']]
      .filter(([k]) => !String(val(k) ?? '').trim()).map(([, label]) => label);
    if (miss.length) throw new BadRequestException(`Заполните: ${miss.join(', ')}`);
  }

  async create(dto: SalesOrderDto, userId?: string) {
    if (dto.initialLegal && dto.stage && dto.stage !== 'new') {
      throw new BadRequestException('Исходный договор сначала сохраняется как новый; запуск производства выполняется после сопоставления позиций');
    }
    const {f,companyShort}=await this.toFields(dto);
    const selectedCompany=f.companyId?String(f.companyId):'';
    let source:Doc={};
    if(dto.initialLegal){
      if(!selectedCompany||(dto.initialLegal.origin?.kind!=='manual'&&(!dto.counterpartyId||!dto.intakeUid)))throw new BadRequestException('Для источника выберите нашу компанию, контрагента и ключ загрузки');
      if(dto.initialLegal.origin?.kind==='source_import'&&(String(dto.initialLegal.sourceNumber||'').trim()!==String(dto.orderNo||'').trim()||f.contractDate&&(f.contractDate as Date).toISOString().slice(0,10)!==dto.initialLegal.sourceDate))throw new BadRequestException('Номер и дата договора должны совпадать с источником');
      await assertIntakeIndexes(this.model,['c164_sales_intake_uid','c164_sales_intake_key']);
      await assertSalesBusinessIndex(this.model);
      const intakeKey=dto.initialLegal.origin?.kind==='manual'?legalHash(['contract-derived',selectedCompany,dto.counterpartyId,dto.orderNo]):intakeBusinessKey(dto.initialLegal,'contract'),intakeHash=intakeContentHash(dto);
      const intakeUid=dto.intakeUid||'manual-'+intakeKey;
      const dup=await this.model.findOne({$or:[{intakeUid},{intakeKey}]}).setOptions({includeSoftDeleted:true}).lean().exec();
      if(dup){assertIntakeReplay(dup as any,intakeHash);return this.get(String(dup._id));}
      await validateLegalParties(this.connection,selectedCompany,dto.counterpartyId||undefined,dto.initialLegal);
      const initial = dto.initialLegal;
      const checkDeadline = initial.origin?.kind === 'source_import' && initial.state === 'draft' &&
        !initial.issues.some(issue => issue.field === 'deadlineTerms');
      if (checkDeadline && initial.issues.length >= 50) throw new BadRequestException('Освободите место для проверки срока договора');
      const legal = prepareLegal(checkDeadline ? {
        ...initial,
        issues: [...initial.issues, {
          uid: 'deadline-' + intakeKey.slice(0, 32),
          field: 'deadlineTerms',
          label: 'Срок по договору',
          reason: 'Сверьте дату или условие отсчёта по подписанному документу и приложениям.',
          state: 'unknown',
          documentUid: initial.documents.find(doc => doc.kind === 'contract')?.uid,
        }],
      } : initial, undefined, userId);
      await validateLegalFiles(this.connection, legal);
      source={legal,legalVersion:0,intakeUid,intakeKey,intakeHash};
    }else if(dto.intakeUid)throw new BadRequestException('Для ключа загрузки нужен комплект источника');
    if (dto.clientUid&&!dto.initialLegal) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id));
    }
    // Новый договор всегда получает № заказа: пусто → следующий свободный «N-ГГ» (last+1).
    if(dto.productionAssignment==='unassigned'){if(f.productionNo)throw new BadRequestException('Договор без заказа не должен содержать номер производства');}
    else if(dto.productionAssignment==='existing'){if(!f.productionNo||!(await this.model.exists({productionNo:f.productionNo,deletedAt:null})))throw new BadRequestException('Выберите существующий заказ производства');}
    else if (!String(f.productionNo ?? '').trim()) f.productionNo = (await this.nextProductionNo()).value;
    if (dto.requireFields) this.checkRequired(dto.productionAssignment==='unassigned'?{...f,productionNo:'без заказа'}:f);
    if (!f.orderNo) throw new BadRequestException('Укажите № договора');
    const key = orderKey(companyShort ?? '', f.orderNo);
    const taken = await this.clash(key,undefined,!!source.intakeKey);
    if (taken && source.intakeKey) {
      // Первый одинаковый запрос мог завершиться после начальной проверки UID.
      const replay = await this.model.findOne({ _id: taken._id }).setOptions({ includeSoftDeleted: true }).lean().exec();
      if (replay?.intakeKey === source.intakeKey) {
        assertIntakeReplay(replay as unknown as Doc, String(source.intakeHash));
        return this.get(String(replay._id));
      }
    }
    if (taken) throw new ConflictException(`Договор № ${f.orderNo}${companyShort ? ` у ${companyShort}` : ''} уже есть${taken.deletedAt ? ' (в корзине)' : ''}`);
    const createDocument={...source,
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
      stage: f.stage ?? 'new', importKey: key, clientUid: dto.clientUid,
      ...(f.productionNo?{productionAddedAt:new Date()}:{}),
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    };
    let doc;try{doc=await this.model.create(createDocument);}catch(e){if((e as {code?:number}).code!==11000)throw e;if(!source.intakeKey)throw new ConflictException('Договор с таким номером у нашей компании уже существует');const dup=await this.model.findOne({$or:[{intakeKey:source.intakeKey},{intakeUid:dto.intakeUid}]}).setOptions({includeSoftDeleted:true}).lean().exec();if(!dup)throw new ConflictException('Договор с таким номером у нашей компании уже существует — сверка обязательна');assertIntakeReplay(dup as any,String(source.intakeHash));return this.get(String(dup._id));}
    await this.afterCreate(doc.toObject() as unknown as Doc, userId);
    return this.get(String(doc._id));
  }

  async updateLegal(id:string,dto:LegalPatchDto,userId?:string){if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Договор не найден');
    await withOrderWrite(this.connection,[id],session => patchLegal(this.model,id,dto,userId,session));return this.get(id);}

  /** ЗО-3/5: новый заказ — личному менеджеру, иначе зоне «Договоры», иначе руководству («Не назначено»). */
  private async afterCreate(o: Doc, actorId?: string) {
    try {
      if (o.responsibleId) await this.zones?.recordHandoff({ entity: 'salesorder', entityId: o._id, field: 'responsibleId', to: o.responsibleId, byUserId: actorId });
      await this.zones?.notifyZone('contracts', { type: 'order_new', text: `Новый заказ № ${o.orderNo ?? ''}${o.customer ? ' · ' + o.customer : ''}`, href: `#salesorders?open=${String(o._id)}` }, { personId: o.responsibleId, actorId });
    } catch { /* уведомление не ломает создание */ }
  }

  /** Договор без живых позиций нельзя отправить в производство и дальше (заказ 22-26 ушёл «пустым»). */
  async assertHasLines(docs: Doc[], target?: string) {
    if (!target || ORDER_STAGES.indexOf(target as OrderStage) < ORDER_STAGES.indexOf('production') || target === 'cancelled') return;
    const fresh = docs.filter((d) => (d.stage || 'new') === 'new');
    const manual=fresh.length?await this.incomes().find({orderId:{$in:fresh.map(d=>d._id)},matchingMode:'manual',deletedAt:null,cancelledAt:null},{projection:{orderId:1,matchingMode:1}}).toArray():[];
    const manualIds=new Set(manual.filter(d=>d.matchingMode==='manual').map(d=>String(d.orderId)));
    const source=fresh.filter(d=>!!d.legal||manualIds.has(String(d._id)));
    if(source.length){const matches=await loadOrderMatches(this.connection.db!,source.map(d=>d._id));for(const d of source){const m=matches.get(String(d._id));if(!m?.total||m.unmatched.length)throw new ConflictException('Перед запуском производства сопоставьте позиции договора с изделиями');}}
    for (const d of fresh) {
      const n = await this.incomes().countDocuments({ orderId: d._id, deletedAt: null, cancelledAt: null }, { limit: 1 });
      if (!n) throw new ConflictException(`В договоре ${d.orderNo || ''} нет позиций — добавьте позиции, потом переводите в производство`);
    }
  }

  /**
   * Этап 3: шаг назад (и выход из «закрыт» / «отменён») — только администратор и только с причиной.
   * Вперёд можно любым путём; отгрузка сама переставляет этап напрямую (`stageAfterShipments`) и сюда не попадает.
   */
  private checkStageMove(cur: Doc, dto: SalesOrderDto, actor?: AuthenticatedUser) {
    if (dto.stage === undefined || !actor || actor.keyScope) return;
    const from = String(cur.stage || 'new'), to = dto.stage;
    if (from === to) return;
    const ORDER = ['new', 'production', 'ready', 'partly', 'shipped', 'closed'];
    const back = from === 'cancelled' || (to !== 'cancelled' && ORDER.indexOf(to) < ORDER.indexOf(from));
    if (!back) return;
    if (actor.role !== 'admin') throw new ForbiddenException('Вернуть заказ на прежний этап может только администратор');
    if (String(dto.stageReason ?? '').trim().length < 3) throw new BadRequestException('Укажите причину возврата на прежний этап');
  }

  async update(id: string, dto: SalesOrderDto, userId?: string, actor?: AuthenticatedUser) {
    if(dto.initialLegal||dto.intakeUid||dto.productionAssignment)throw new BadRequestException('Комплект источников меняется отдельным действием карточки');
    const cur = await this.findRaw(id);
    if (cur.activeArchiveVersion != null) throw archiveOrderConflict();
    await this.assertHasLines([cur as Doc], dto.stage);
    this.checkStageMove(cur as Doc, dto, actor);
    const { f, companyShort } = await this.toFields(dto);
    if(cur.legal&&['companyId',...((cur.legal as any).counterpartySnapshot?['counterpartyId']:[])].some(k=>k in f&&String(f[k]||'')!==String(cur[k]||'')))throw new ConflictException('Стороны исходного договора зафиксированы');
    if (dto.requireFields) this.checkRequired(cur.legal&&!cur.productionNo?{...f,productionNo:'без заказа'}:f, cur as Doc);
    if ('orderNo' in f && !f.orderNo) throw new BadRequestException('№ договора не может быть пустым');
    if ('orderNo' in f || companyShort !== undefined) {
      const company = companyShort !== undefined ? companyShort ?? '' : await this.companyShort(cur.companyId);
      const no = (f.orderNo ?? cur.orderNo) as string;
      const key = orderKey(company, no);
      if (key !== cur.importKey && await this.clash(key, cur._id as Types.ObjectId)) throw new ConflictException(`Договор № ${no}${company ? ` у ${company}` : ''} уже есть`);
    }
    // importKey не меняется: по нему лист «Заказы» и импорт продолжают находить эту шапку
    const set: Doc = { editedInApp: true }, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(f)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    // № заказа менялся: фиксируем дату входа в заказ (порядок договоров); убрать договор из заказа с выдачами/отгрузками нельзя
    if ('productionNo' in f && (f.productionNo ?? '') !== (cur.productionNo ?? '')) {
      if (f.productionNo) set.productionAddedAt = new Date(); else unset.productionAddedAt = '';
    }
    await withOrderWrite(this.connection, [cur._id], async session => {
      if (cur.productionNo && 'productionNo' in f && f.productionNo !== cur.productionNo) await this.ensureDetachable(cur._id as Types.ObjectId, session);
      await this.model.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session }).exec();
      await this.syncLines(cur._id as Types.ObjectId, f, session);
    });
    if ('responsibleId' in f) await this.zones?.recordHandoff({ entity: 'salesorder', entityId: cur._id, field: 'responsibleId', from: cur.responsibleId, to: f.responsibleId, byUserId: userId });
    return this.get(id);
  }

  /** Договор можно вывести из заказа, только если по нему нет выдач со склада и отгрузок. */
  async ensureDetachable(orderId: Types.ObjectId, session: ClientSession) {
    const db = this.connection.db!;
    const issued = await db.collection('stockmovements').countDocuments({ salesOrderId: orderId, deletedAt: null, cancelledAt: null }, { limit: 1, session });
    const shipped = await db.collection('shipments').countDocuments({ orderId, deletedAt: null }, { limit: 1, session });
    if (issued || shipped) throw new ConflictException('Договор уже в работе: есть выдачи/отгрузки');
  }

  /** Правка шапки → кэш-поля в позициях; при смене даты отгрузки reportDate = оплата ?? отгрузка. */
  private syncLines(orderId: Types.ObjectId, f: Doc, session: ClientSession) {
    return syncOrderHeaderCache(this.connection.db!, orderId, f, session);
  }

  /** В корзину вместе с позициями (позиции помечаются, чтобы восстановить ровно их; лист «Заказы» их больше не трогает). */
  async remove(id: string) {
    const cur = await this.findRaw(id);
    if (cur.activeArchiveVersion != null) throw archiveOrderConflict();
    // CANON: нельзя удалить то, на что ссылаются — оплата и отгрузки хранят деньги и склад
    const paid = await this.incomes().countDocuments({ orderId: cur._id, deletedAt: null, $or: [{ paidAmount: { $gt: 0 } }, { paidDate: { $ne: null } }, { 'payments.0': { $exists: true } }] });
    if (paid) throw new ConflictException(`В заказе есть оплаты (позиций с оплатой: ${paid}) — сначала уберите платежи в карточке позиции`);
    const shipped = await this.connection.db!.collection('shipments').countDocuments({ orderId: cur._id, deletedAt: null });
    if (shipped) throw new ConflictException(`По заказу есть отгрузки (${shipped}) — сначала отмените их на вкладке «Отгрузки»`);
    const now = new Date();
    // заказ и его позиции — одной транзакцией: не останется заказа в корзине с живыми позициями
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await claimWritableOrders(this.connection.db!, session, [cur._id]);
        if (await this.incomes().countDocuments({ orderId: cur._id, deletedAt: null, $or: [{ paidAmount: { $gt: 0 } }, { paidDate: { $ne: null } }, { 'payments.0': { $exists: true } }] }, { session })) throw new ConflictException('В заказе есть оплаты');
        if (await this.connection.db!.collection('shipments').countDocuments({ orderId: cur._id, deletedAt: null }, { session })) throw new ConflictException('По заказу есть отгрузки');
        await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: now, editedInApp: true } }, { session }).exec();
        await softDeleteLinesWithOrder(this.connection.db!, cur._id as Types.ObjectId, now, session);
      });
    } finally { await session.endSession(); }
    return { id, deleted: true };
  }

  async restore(id: string) {
    const cur = await this.findRaw(id, true);
    await withOrderWrite(this.connection, [cur._id], async session => {
      await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: null } }, { session }).setOptions({ includeSoftDeleted: true }).exec();
      await restoreLinesDeletedWithOrder(this.connection.db!, cur._id as Types.ObjectId, session);
    });
    return this.get(id);
  }

  /** Единая лента заказа (order-history.ts): изменения, позиции, оплата, проектирование, паспорта, отгрузки, склад. */
  async history(id: string, q: Record<string, unknown>, acc: HistoryAccess) {
    const t = String(q.type ?? '').trim();
    if (t && !(HISTORY_TYPES as readonly string[]).includes(t)) throw new BadRequestException(`Тип «${t}» неизвестен: ${HISTORY_TYPES.join(', ')}`);
    const doc = await this.findRaw(id);
    return loadOrderHistory(this.connection.db!, doc._id as Types.ObjectId, q, acc);
  }

  /** ПРЖ-4: подбор изделий для позиций без productId. Без apply — предложения; с apply — запись picks (productId=null — снять). */
  async matchProducts(id: string, apply = false, picks: { lineId: string; productId: string | null }[] = []) {
    const order = await this.findRaw(id);
    const lines = await this.incomes().find({ orderId: order._id, deletedAt: null, cancelledAt: null, productId: null }, { projection: { lineNo: 1, title: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
    if (!apply) {
      const prods = (await this.connection.db!.collection('products').find({ deletedAt: null }, { projection: { name: 1, fullName: 1, orderName: 1, sku: 1 } }).toArray())
        .map((p) => ({ id: String(p._id), name: p.name as string, fullName: p.fullName as string, orderName: p.orderName as string, sku: p.sku as string }));
      return { applied: false, items: lines.map((l) => ({ lineId: String(l._id), lineNo: (l.lineNo as number | undefined) ?? null, title: (l.title as string | undefined) ?? '', suggestions: suggestProducts(String(l.title ?? ''), prods) })) };
    }
    const own = new Set(lines.map((l) => String(l._id)));
    const todo = picks.filter((x) => x?.productId);
    const ids = [...new Set(todo.map((x) => String(x.productId)))].map((v) => oid(v, 'изделия'));
    const found = new Set((await this.connection.db!.collection('products').find({ _id: { $in: ids }, deletedAt: null }, { projection: { _id: 1 } }).toArray()).map((p) => String(p._id)));
    return withOrderWrite(this.connection, [order._id], async session => {
      for (const x of todo) {
        if (!own.has(String(x.lineId))) throw new BadRequestException('Позиция не из этого заказа или уже с изделием');
        if (!found.has(String(x.productId))) throw new BadRequestException('Изделие не найдено');
        await confirmOrderLineProduct(this.connection.db!, oid(x.lineId, 'позиции'), order._id as Types.ObjectId, oid(String(x.productId), 'изделия'), session);
      }
      return { applied: true, count: todo.length };
    });
  }
}
