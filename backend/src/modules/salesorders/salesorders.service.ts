import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { tokensFilter } from '../../common/text/search-norm';
import { ourCompanies } from '../incomes/incomes.service';
import { normText } from '../../common/text/norm-text';
import type { SalesOrderDto } from './dto';
import { ACTIVE_STAGES, DONE_STAGES, ORDER_STAGES, STAGE_LABELS, orderKey, type OrderStage } from '../../common/text/order-key';
import { netIssuedByLine } from '../../common/issued-net';
import { ORDER_CACHE_FIELDS } from './order-link';
import { SalesOrder, SalesOrderDocument } from './sales-order.schema';

type Doc = Record<string, unknown>;
const SORT = ['orderNo', 'customer', 'stage', 'shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate', 'createdAt', 'updatedAt', 'deletedAt'];
const TEXT = ['orderNo', 'customer', 'title', 'paymentForm', 'contractNo', 'notes'] as const;
const DATES = [['contractDate', 'Дата контракта'], ['shipDate', 'Дата отгрузки'], ['productionDeadline', 'Срок изготовления'], ['deliveryDeadline', 'Окончание поставки']] as const;

/**
 * Заказы заказчиков (TASKS З.1): шапка в `salesorders`, позиции — `incomes` с orderId.
 * Карточка (`get`) собирает позиции, заявки снабжения и движения склада, привязанные к заказу.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesOrder.name) private readonly model: Model<SalesOrderDocument>,
  ) {}

  private incomes() { return this.connection.db!.collection('incomes'); }

  private async present(docs: Doc[]) {
    const companies = await ourCompanies(this.connection);
    const name = new Map(companies.map((c) => [String(c.id), c.name]));
    // сводка по позициям: сколько строк, на какую сумму и сколько оплачено
    const ids = docs.map((d) => d._id as Types.ObjectId);
    const agg = ids.length ? await this.incomes().aggregate([
      { $match: { orderId: { $in: ids }, deletedAt: null } },
      { $group: { _id: '$orderId', lines: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $ifNull: ['$paidDate', false] }, '$amount', 0] } } } },
    ]).toArray() : [];
    const sum = new Map(agg.map((a) => [String(a._id), a]));
    return docs.map((d) => {
      const s = sum.get(String(d._id));
      const stage = (d.stage as OrderStage) || 'new';
      return {
        ...d, id: String(d._id), _id: String(d._id),
        companyName: d.companyId ? name.get(String(d.companyId)) ?? null : null,
        stage, stageLabel: STAGE_LABELS[stage] ?? stage,
        lineCount: s?.lines ?? 0, amount: s?.amount ?? 0, paidAmount: s?.paid ?? 0,
      };
    });
  }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: SORT, defaultSort: '-createdAt', defaultLimit: 25 });
    const filter: Doc = { deletedAt: p.deleted ? { $ne: null } : null };
    if (q.companyId) filter.companyId = { $in: oids(q.companyId) };
    const range = dateRange(q.from, q.to);
    if (range) filter.shipDate = range;
    // dueTo=ГГГГ-ММ-ДД — срок (отгрузка, иначе изготовление, иначе окончание поставки) не позже даты: очередь «Сроки по заказам»
    const due = q.dueTo ? dateRange(undefined, q.dueTo) : null;
    if (due) filter.$and = [{ $or: [{ shipDate: due }, { shipDate: null, productionDeadline: due }, { shipDate: null, productionDeadline: null, deliveryDeadline: due }] }];
    // поиск «как на складе»: каждое слово — в одном из полей (И), ё = е, M10 = М10
    const sf = tokensFilter(q.search, ['orderNo', 'customer', 'title', 'contractNo', 'notes']);
    if (sf) filter.$and = [...((filter.$and as unknown[]) ?? []), ...sf.$and];
    // этапы: filter=active|done|all или явный список stage=new,production
    let stages: string[] | undefined;
    if (q.filter === 'active') stages = ACTIVE_STAGES;
    else if (q.filter === 'done') stages = DONE_STAGES;
    else if (q.filter && q.filter !== 'all') throw new BadRequestException('Параметр filter: active (в работе), done (завершённые) или all (все)');
    if (q.stage) {
      const want = String(q.stage).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = want.find((s) => !(ORDER_STAGES as readonly string[]).includes(s));
      if (bad) throw new BadRequestException(`Неизвестный этап «${bad}»`);
      stages = stages ? stages.filter((s) => want.includes(s)) : want;
    }
    const full = { ...filter, ...(stages ? { stage: { $in: stages } } : {}) };
    const [docs, total, byStage] = await Promise.all([
      this.model.find(full).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
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

  /** Карточка: шапка + позиции + заявки снабжения и движения склада под этот заказ. */
  async get(id: string) {
    const doc = await this.findRaw(id);
    const _id = doc._id as Types.ObjectId;
    // Привязка — поля data-core salesOrderId (orderId в заявках занят CRM-заказами)
    const db = this.connection.db!;
    const [lines, supplyRequests, stockMovements, reservations] = await Promise.all([
      this.incomes().find({ orderId: _id, deletedAt: null }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray(),
      db.collection('supplyrequests').find({ salesOrderId: _id, deletedAt: null }, { projection: { num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, requestDate: 1, salesOrderLineId: 1, supplierId: 1 } }).sort({ requestDate: -1 }).toArray(),
      db.collection('stockmovements').find({ salesOrderId: _id, deletedAt: null, cancelledAt: null }, { projection: { type: 1, date: 1, materialId: 1, qty: 1, notes: 1, salesOrderLineId: 1, issuedToPersonId: 1, issuedTo: 1, reservationId: 1, reason: 1, isReturn: 1, cancelOf: 1 } }).sort({ date: -1 }).toArray(),
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
    const issuedByLine = netIssuedByLine(stockMovements as never).map((r) => ({ ...r, materialName: (matName.get(r.materialId)?.name as string | undefined) ?? null, unit: (matName.get(r.materialId)?.unit as string | undefined) ?? null }));
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
    // Фото позиций (из Excel «Вид» или загруженные): первое — превью в карточке заказа
    const phIds = lines.flatMap((l) => ((l.photoIds as Types.ObjectId[] | undefined) ?? []).slice(0, 1));
    const ph = phIds.length ? await db.collection('photos').find({ _id: { $in: phIds } }, { projection: { storageUrl: 1 } }).toArray() : [];
    const thumbs = phIds.length ? await db.collection('photos').find({ parentPhotoId: { $in: phIds }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray() : [];
    const phUrl = new Map(ph.map((p) => [String(p._id), String(p.storageUrl)]));
    const thUrl = new Map(thumbs.map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
    for (const l of lines as Doc[]) { const id = String(((l.photoIds as unknown[]) ?? [])[0] ?? ''); if (phUrl.has(id)) l.photo = { url: phUrl.get(id), thumb: thUrl.get(id) ?? phUrl.get(id) }; }
    const header = (await this.present([doc]))[0];
    const fix = (a: Doc[]) => a.map((x) => ({ ...x, id: String(x._id), _id: String(x._id) }));
    return {
      ...header,
      lines: fix(lines.map((l) => ({ ...l, status: l.paidDate ? 'paid' : l.shipDate ? 'awaiting' : 'draft' }))),
      supplyRequests: fix(supplyRequests), stockMovements: fix(stockMovements), issuedByLine,
      reservations: [...resGroups.values()].map((g) => ({ ...g, left: Math.round(g.left * 1000) / 1000, issued: Math.round(g.issued * 1000) / 1000 })),
    };
  }

  /**
   * Позиции заказа для выбора при выдаче со склада (SK-5): без цен, с картинкой.
   * photoId — первое фото позиции, иначе главное фото изделия, иначе null.
   */
  async linesLookup(id: string) {
    const order = await this.findRaw(id);
    const db = this.connection.db!;
    const lines = await this.incomes().find({ orderId: order._id, deletedAt: null }, { projection: { lineNo: 1, title: 1, productId: 1, photoIds: 1, qty: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
    const need = lines.filter((l) => !(l.photoIds as unknown[] | undefined)?.length && l.productId).map((l) => l.productId as Types.ObjectId);
    const byProduct = new Map<string, Types.ObjectId>();
    if (need.length) {
      const pp = await db.collection('productphotos').find({ productId: { $in: need }, photoId: { $ne: null }, deletedAt: null }, { projection: { productId: 1, photoId: 1 } }).sort({ isMain: -1, sortOrder: 1 }).toArray();
      for (const x of pp) if (!byProduct.has(String(x.productId))) byProduct.set(String(x.productId), x.photoId as Types.ObjectId);
    }
    return lines.map((l) => ({
      id: String(l._id), orderNo: (order.orderNo as string | undefined) ?? null, lineNo: (l.lineNo as number | undefined) ?? null, title: l.title ?? '',
      productId: l.productId ? String(l.productId) : null,
      photoId: String(((l.photoIds as Types.ObjectId[] | undefined) ?? [])[0] ?? (l.productId ? byProduct.get(String(l.productId)) : undefined) ?? '') || null,
      qty: (l.qty as number | undefined) ?? null,
    }));
  }

  /** Поля формы → поля схемы; undefined = очистить. companyShort: undefined — компанию не меняли, null — убрали. */
  private async toFields(dto: SalesOrderDto): Promise<{ f: Doc; companyShort?: string | null }> {
    const f: Doc = {};
    for (const k of TEXT) if (dto[k] !== undefined) f[k] = String(dto[k] ?? '').trim() || undefined;
    for (const [k, label] of DATES) {
      if (dto[k] === undefined) continue;
      const d = parseSheetDate(dto[k]);
      if (dto[k] && !d) throw new BadRequestException(`${label} — в формате ДД.ММ.ГГГГ`);
      f[k] = d;
    }
    if (dto.stage !== undefined) f.stage = dto.stage;
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
  private async clash(key: string, exceptId?: Types.ObjectId) {
    const byKey = await this.model.findOne({ importKey: key, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (byKey) return byKey;
    const no = key.slice(key.indexOf('|') + 1);
    const cands = await this.model.find({ deletedAt: null, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { orderNo: 1, companyId: 1 }).lean().exec();
    for (const c of cands) if (orderKey('', c.orderNo).slice(1) === no && orderKey(await this.companyShort(c.companyId), c.orderNo) === key) return c;
    return null;
  }

  async create(dto: SalesOrderDto, userId?: string) {
    if (dto.clientUid) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id));
    }
    const { f, companyShort } = await this.toFields(dto);
    if (!f.orderNo) throw new BadRequestException('Укажите № заказа');
    const key = orderKey(companyShort ?? '', f.orderNo);
    const taken = await this.clash(key);
    if (taken) throw new ConflictException(`Заказ № ${f.orderNo}${companyShort ? ` у ${companyShort}` : ''} уже есть${taken.deletedAt ? ' (в корзине)' : ''}`);
    const doc = await this.model.create({
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
      stage: f.stage ?? 'new', importKey: key, clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    });
    return this.get(String(doc._id));
  }

  async update(id: string, dto: SalesOrderDto) {
    const cur = await this.findRaw(id);
    const { f, companyShort } = await this.toFields(dto);
    if ('orderNo' in f && !f.orderNo) throw new BadRequestException('№ заказа не может быть пустым');
    if ('orderNo' in f || companyShort !== undefined) {
      const company = companyShort !== undefined ? companyShort ?? '' : await this.companyShort(cur.companyId);
      const no = (f.orderNo ?? cur.orderNo) as string;
      const key = orderKey(company, no);
      if (key !== cur.importKey && await this.clash(key, cur._id as Types.ObjectId)) throw new ConflictException(`Заказ № ${no}${company ? ` у ${company}` : ''} уже есть`);
    }
    // importKey не меняется: по нему лист «Заказы» и импорт продолжают находить эту шапку
    const set: Doc = { editedInApp: true }, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(f)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    await this.model.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    await this.syncLines(cur._id as Types.ObjectId, f);
    return this.get(id);
  }

  /** Правка шапки → кэш-поля в позициях; при смене даты отгрузки reportDate = оплата ?? отгрузка. */
  private async syncLines(orderId: Types.ObjectId, f: Doc) {
    const stage: Doc = {};
    for (const k of ORDER_CACHE_FIELDS) if (k in f) stage[k] = f[k] === undefined ? '$$REMOVE' : { $literal: f[k] };
    if (!Object.keys(stage).length) return;
    const pipeline: Doc[] = [{ $set: { ...stage, updatedAt: new Date() } }];
    // Mongo 4.4: у $ifNull ровно 2 аргумента — вкладываем
    if ('shipDate' in f) pipeline.push({ $set: { reportDate: { $ifNull: ['$paidDate', { $ifNull: ['$shipDate', '$$REMOVE'] }] } } });
    await this.incomes().updateMany({ orderId }, pipeline);
  }

  /** В корзину вместе с позициями (позиции помечаются, чтобы восстановить ровно их; лист «Заказы» их больше не трогает). */
  async remove(id: string) {
    const cur = await this.findRaw(id);
    const now = new Date();
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: now, editedInApp: true } }).exec();
    await this.incomes().updateMany({ orderId: cur._id, deletedAt: null }, { $set: { deletedAt: now, deletedWithOrder: true, editedInApp: true, updatedAt: now } });
    return { id, deleted: true };
  }

  async restore(id: string) {
    const cur = await this.findRaw(id, true);
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    await this.incomes().updateMany({ orderId: cur._id, deletedWithOrder: true }, { $set: { deletedAt: null, updatedAt: new Date() }, $unset: { deletedWithOrder: '' } });
    return this.get(id);
  }
}
