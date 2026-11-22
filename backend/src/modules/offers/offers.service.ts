import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { offerPhotos } from './offer-photos';
import { adminOverride, isAdminActor, overrideReason } from '../../common/admin-override';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../counter/counter.service';
import { IncomesService, ourCompanies } from '../incomes/incomes.service';
import { SalesOrdersService } from '../salesorders/salesorders.service';
import { offersOnlyIds, saveOffersOnlyIds } from '../../common/offers-only';
import { legalHash, intakeContentHash, intakeBusinessKey, legalSummary, prepareLegal, validateLegalFiles, validateLegalParties, assertIntakeIndexes, patchLegal, assertIntakeReplay, legalPresentation } from '../../common/legal/legal-utils';
import type { LegalPatchDto } from '../../common/legal/legal.dto';
import { agreedOfferTotal, assertOfferOrderMatch, cents, validateSourceItems } from './offer-source';
import type { OfferLinkOrderDto, CreateOfferDto, OfferCopiesDto, OfferPackDto, OfferCopyDto, OfferCreateOrderDto, UpdateOfferDto } from './dto';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { offerProblems, packProblems } from './offer-ready';
import { OfferGeometry } from './offer-geometry';
import { renderOfferPdf, newOfferPageMap, type OfferPageMap } from './offer-pdf';
import { calcTotals, checkEditable, checkMove, markedLinePrice, offerLineKind, resolveVat } from './offer-rules';
import { customerNameRegex, offerCustomerKey, pickLastOffer, presentLastOffer, type LastOfferRow } from './offer-last';
import { CommercialOffer, OFFER_STATUSES, type OfferDocument, type OfferStatus } from './offer.schema';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Дата ГГГГ-ММ-ДД → полночь UTC; пусто — сегодня по Москве. */
const day = (v?: string) => new Date(`${v ? String(v).slice(0, 10) : new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}T00:00:00.000Z`);
const clean = (v: unknown) => String(v ?? '').trim();

/** Коммерческие предложения (КП-1): сохранение, статусы, PDF. Коллекция `commercialoffers` (не CRM-овские `quotations`). */
@Injectable()
export class OffersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CommercialOffer.name) private readonly model: Model<OfferDocument>,
    private readonly counters: CounterService,
    private readonly bgs: OfferBackgroundsService,
    private readonly salesOrders: SalesOrdersService,
    private readonly incomes: IncomesService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private db() { return this.connection.db!; }

  private present(o: Doc, companyName?: string | null, packSize?: number | null, detail = false) {
    return {
      id: String(o._id), sourceNumber: o.sourceNumber ?? null, number: o.number, date: o.date, validUntil: o.validUntil ?? null,
      companyId: String(o.companyId), companyName: companyName ?? null,
      customer: o.customer, counterpartyId: o.counterpartyId ? String(o.counterpartyId) : null, title: o.title ?? null,
      objectName: o.objectName ?? null, vatMode: o.vatMode ?? null, vatRate: o.vatRate ?? null, delivery: o.delivery ?? null, copyOf: o.copyOf ? String(o.copyOf) : null,
      packId: o.packId ? String(o.packId) : null, packSize: packSize ?? null,
      status: o.status as OfferStatus,
      items: (o.items as Doc[]).map((i) => ({
        lineKind: offerLineKind(i), pageBreakBefore: i.pageBreakBefore, photoMm: i.photoMm, rowMm: i.rowMm,
        sourceRowKey: i.sourceRowKey ?? null, sourceLine: i.sourceLine ?? null, scopeState: i.scopeState ?? 'included',
        exclusionReason: i.exclusionReason ?? null, exclusionConfirmedAt: i.exclusionConfirmedAt ?? null, exclusionEventDate: i.exclusionEventDate ?? null, matchStatus: i.matchStatus ?? (i.productId ? 'confirmed' : 'unmatched'),
        productId: i.productId ? String(i.productId) : null, productName: i.productName, productSku: i.productSku ?? null, description: i.description ?? null,
        color: i.color ?? null, size: i.size ?? null, photoUrl: i.photoUrl ?? null, quantity: i.quantity, unit: i.unit || 'шт', unitPrice: i.unitPrice ?? null, total: i.total ?? 0,
      })),
      agreedTotal: agreedOfferTotal(o.items || []), total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent ?? null, productionDays: o.productionDays ?? null, deliveryDays: o.deliveryDays ?? null,
      terms: o.terms ?? null, notes: o.notes ?? null, bg1Id: o.bg1Id ?? null, bg2Id: o.bg2Id ?? null, orderId: o.orderId ? String(o.orderId) : null,
      legalSummary: o.legal ? legalSummary(o.legal, (o.items || []).filter((r: Doc) => r.scopeState !== 'excluded' && !r.productId).length) : null,
      ...(detail ? { layout: o.layout, legal: o.legal, legalVersion: o.legalVersion ?? 0, readiness: legalPresentation({ ...o, unassignedCount: (o.items || []).filter((r: Doc) => r.scopeState !== 'excluded' && !r.productId).length }).readiness, versions: o.versions || [], legalHistory: o.legalHistory || [] } : {}),
      versionCount: Number(o.versionCount ?? ((o.versions as Doc[]) ?? []).length),
      statusHistory: (o.statusHistory as Doc[]) ?? [], createdAt: o.createdAt ?? null, updatedAt: o.updatedAt ?? null,
    };
  }

  private snapshot(o: Doc) {
    return {
      layout: o.layout, bg1Id: o.bg1Id, bg2Id: o.bg2Id, validUntil: o.validUntil, customer: o.customer, companyId: String(o.companyId), counterpartyId: o.counterpartyId, date: o.date, sourceNumber: o.sourceNumber, legal: o.legal, title: o.title ?? null, items: o.items, total: o.total, agreedTotal: agreedOfferTotal(o.items || []),
      objectName: o.objectName ?? null, vatMode: o.vatMode ?? null, vatRate: o.vatRate ?? null, delivery: o.delivery ?? null,
      terms: o.terms ?? null, notes: o.notes ?? null, prepaymentPercent: o.prepaymentPercent ?? null, productionDays: o.productionDays ?? null, deliveryDays: o.deliveryDays ?? null,
    };
  }

  private assertOrderFromOffer(o: Doc) {
    if (o.orderId) throw new BadRequestException('Заказ из этого КП уже создан — откройте его из карточки');
    if (!['accepted', 'paid'].includes(String(o.status))) throw new BadRequestException('Сначала отметьте КП «Принято» или «Оплачено»');
    if (!(o.items as Doc[])?.length) throw new BadRequestException('В КП нет строк');
  }

  async toOrder(id: string) {
    const o = await this.find(id);
    this.assertOrderFromOffer(o);
    const companyName = await this.companyName(o.companyId);
    const productionNo = o.legal ? '' : (await this.salesOrders.nextProductionNo({})).value;
    const orderNo = `КП-${String(o.number).replace(/^КП-?/i, '').slice(0, 40)}`;
    return {
      offerId: String(o._id), offerNo: o.number,
      header: { orderNo, productionNo, customer: o.customer, companyId: String(o.companyId), companyName: companyName ?? '', title: `По ${o.number}`, stage: 'new' as const },
      lines: (o.items as Doc[]).filter((i) => i.scopeState !== 'excluded').map((i) => ({
        productId: i.productId ? String(i.productId) : null, title: i.productName, qty: i.quantity, unit: i.unit || 'шт', color: i.color ?? null, size: i.size ?? null,
        // цена КП идёт в позицию заказа (решение владельца 2026-11-11, C068-3); НДС в КП — внутри цены
        unitPrice: typeof i.unitPrice === 'number' && i.unitPrice > 0 ? i.unitPrice : null,
        sourceLine: i.sourceLine, sourceRowKey: i.sourceRowKey,
      })),
    };
  }

  async createOrder(id: string, dto: OfferCreateOrderDto, user: AuthenticatedUser) {
    const o = await this.find(id);
    if (o.legal) return this.createSourceOrder(o, dto, user);
    this.assertOrderFromOffer(o);
    const draft = await this.toOrder(id);
    const orderNo = clean(dto.orderNo) || draft.header.orderNo;
    const productionNo = clean(dto.productionNo) || draft.header.productionNo;
    const uid = `offer-order-${String(o._id)}`;
    const head = await this.salesOrders.create({
      orderNo, productionNo, customer: o.customer, companyId: String(o.companyId), title: draft.header.title,
      stage: 'new', paymentForm: 'б/р', requireFields: !o.legal, clientUid: uid,
      offerId: String(o._id), offerNo: String(o.number),
    }, user?.id);
    const orderId = head.id as string;
    let n = 0;
    for (const line of draft.lines) {
      n += 1;
      await this.incomes.create({
        orderId, title: line.title, qty: line.qty, unit: line.unit, color: line.color ?? undefined, size: line.size ?? undefined,
        productId: line.productId ?? undefined, unitPrice: line.unitPrice ?? undefined, lineNo: n, clientUid: `${uid}-line-${n}`,
      }, user?.id, user);
    }
    await this.model.updateOne({ _id: o._id }, { $set: { orderId: oid(orderId, 'заказа') } }).exec();
    const h = head as Doc;
    return { orderId, productionNo: String(h.productionNo ?? productionNo), orderNo: String(h.orderNo ?? orderNo) };
  }

  /** CAS-бронь источника и стабильные UID позволяют восстановить частично созданный черновик без дублей. */
  private async createSourceOrder(current: Doc, dto: OfferCreateOrderDto, user: AuthenticatedUser) {
    if (dto.version === undefined) throw new BadRequestException('Для конверсии исходного КП нужна его версия');
    const hash = legalHash(dto);
    const uid = `offer-order-${String(current._id)}`;
    let receipt = current.orderConversion;
    if (receipt) {
      if (receipt.uid !== uid || receipt.hash !== hash) throw new ConflictException('Конверсия уже начата с другими данными — откройте журнал');
      if (receipt.status === 'done') return receipt.result;
    } else {
      this.assertOrderFromOffer(current);
      if (Number(current.legalVersion || 0) !== dto.version) throw new ConflictException('КП изменилось — обновите карточку');
      const snapshot = { ...this.snapshot(current), _id: current._id, number: current.number, legalVersion: current.legalVersion, status: current.status };
      receipt = { uid, hash, status: 'pending', version: dto.version + 1, snapshot, at: new Date() };
      const claim = await this.model.updateOne({ _id: current._id, deletedAt: null, legalVersion: dto.version, orderId: null, orderConversion: { $exists: false } }, { $set: { orderConversion: receipt }, $inc: { legalVersion: 1 } }).exec();
      if (!claim.matchedCount) throw new ConflictException('КП изменилось или конверсия уже начата — обновите карточку');
    }
    const o = receipt.snapshot as Doc;
    const rows = (o.items as Doc[]).filter((r) => r.scopeState !== 'excluded');
    const gross = agreedOfferTotal(rows);
    const orderNo = clean(dto.orderNo) || `КП-${String(o.number).replace(/^КП-?/i, '').slice(0, 40)}`;
    const productionNo = clean(dto.productionNo);
    const legal = { ...o.legal, sourceNumber: orderNo, sourceDate: undefined, gross, state: 'draft',
      vatAmount: o.legal.vatMode === 'included' && o.legal.vatRate !== undefined ? Math.round(gross * o.legal.vatRate / (100 + o.legal.vatRate) * 100) / 100 : undefined,
      signature: { state: 'unknown' }, paymentVerification: 'unknown', paymentPlan: [], origin: { kind: 'manual' },
      issues: [...(o.legal.issues || []).filter((i: Doc) => i.uid !== 'contract-source'), { uid: 'contract-source', field: 'other', label: 'Подтвердить реквизиты договора', reason: 'Черновик составлен по КП; исходный договор ещё не приложен', state: 'unknown' }] };
    const head = await this.salesOrders.create({ orderNo, ...(productionNo ? { productionNo } : {}), productionAssignment: productionNo ? 'existing' : 'unassigned',
      customer: o.customer, companyId: String(o.companyId), counterpartyId: o.counterpartyId ? String(o.counterpartyId) : undefined, title: `По ${o.number}`,
      paymentForm: 'б/р', stage: 'new', requireFields: false, clientUid: uid, intakeUid: uid, initialLegal: legal, offerId: String(o._id), offerNo: o.number }, user?.id);
    const orderId = String(head.id);
    let n = 0;
    for (const row of rows) {
      n += 1;
      await this.incomes.create({ orderId, title: row.productName, qty: row.quantity, unit: row.unit || 'шт', unitPrice: row.unitPrice,
        color: row.color, size: row.size, lineNo: n, clientUid: `${uid}-line-${row.sourceRowKey || n}`, productId: row.productId ? String(row.productId) : undefined,
        matchingMode: 'manual',
        sourceLine: row.sourceLine || { documentUid: o.legal.documents.find((d: Doc) => d.kind === 'offer')?.uid || 'offer', rowKey: row.sourceRowKey || String(n), title: row.productName, qty: row.quantity, unit: row.unit || 'шт', unitPrice: row.unitPrice, lineAmount: row.total } }, user?.id, user);
    }
    const result = { orderId, productionNo: String((head as Doc).productionNo || ''), orderNo: String((head as Doc).orderNo || orderNo) };
    const done = await this.model.updateOne({ _id: current._id, deletedAt: null, legalVersion: receipt.version, 'orderConversion.uid': uid, 'orderConversion.hash': hash, 'orderConversion.status': 'pending' }, { $set: { orderId: oid(orderId, 'договора'), 'orderConversion.status': 'done', 'orderConversion.result': result } }).exec();
    if (!done.matchedCount) throw new ConflictException('Черновик создан; требуется сверка связи с КП, не повторяйте создание');
    return result;
  }

  private assertNoConversion(cur: Doc) {
    if (cur.orderConversion?.status === 'pending') throw new ConflictException('Конверсия КП не завершена — сначала восстановите её по прежнему ключу');
  }

  private async companyName(id: unknown): Promise<string | null> {
    const c = await this.db().collection('organizations').findOne({ _id: id as Types.ObjectId }, { projection: { name: 1, fullName: 1, shortName: 1 } });
    return c ? String(c.shortName || c.name || c.fullName || '') : null;
  }

  /** Короткие имена наших фирм для списка КП (пачкой). */
  private async companyNames(ids: unknown[]): Promise<Map<string, string>> {
    const oids = [...new Set(ids.map((x) => String(x || '')).filter((id) => Types.ObjectId.isValid(id)))].map((id) => new Types.ObjectId(id));
    if (!oids.length) return new Map();
    const rows = await this.db().collection('organizations').find({ _id: { $in: oids } }, { projection: { name: 1, shortName: 1, fullName: 1 } }).toArray();
    return new Map(rows.map((o) => [String(o._id), String(o.shortName || o.name || o.fullName || '')]));
  }

  private async assertCounterparty(id: string) {
    const row = await this.db().collection('organizations').findOne({ _id: oid(id, 'покупателя'), deletedAt: null }, { projection: { _id: 1 } });
    if (!row) throw new BadRequestException('Покупатель не найден');
  }

  async updateLegal(id: string, dto: LegalPatchDto, user: AuthenticatedUser) {
    const cur = await this.find(id);
    this.assertNoConversion(cur);
    if (cur.legal && (dto.legal.sourceDate !== cur.legal.sourceDate || dto.legal.sourceNumber !== cur.legal.sourceNumber || cents(dto.legal.gross) !== cents(cur.legal.gross))) {
      throw new ConflictException('Исходные дата, номер и сумма КП неизменяемы');
    }
    checkEditable(cur.status, { admin: isAdminActor(user), hasOrder: !!cur.orderId });
    await validateLegalParties(this.connection, String(cur.companyId), cur.counterpartyId ? String(cur.counterpartyId) : undefined, dto.legal);
    await patchLegal(this.model, id, dto, user?.id);
    return this.get(id);
  }

  async linkOrder(id: string, dto: OfferLinkOrderDto, user: AuthenticatedUser) {
    const cur = await this.find(id);
    this.assertNoConversion(cur);
    const hash = legalHash({ orderId: dto.orderId, version: dto.version });
    const prior = (cur.linkReceipts || []).find((r: Doc) => r.uid === dto.clientUid);
    if (prior) {
      if (prior.hash !== hash) throw new ConflictException('Ключ привязки уже использован с другими данными');
      return this.get(id);
    }
    if (cur.orderId) throw new ConflictException('КП уже связано с договором');
    if ((cur.legalVersion || 0) !== dto.version) throw new ConflictException('КП изменилось — обновите карточку');
    const order = await this.db().collection('salesorders').findOne({ _id: oid(dto.orderId, 'договора'), deletedAt: null });
    if (!order) throw new NotFoundException('Договор не найден');
    const lines = await this.db().collection('incomes').find({ orderId: order._id, deletedAt: null }).limit(301).toArray();
    if (lines.length > 300) throw new BadRequestException('Слишком много строк для адресного сопоставления');
    assertOfferOrderMatch(cur, order, lines);
    const guard = { _id: cur._id, deletedAt: null, orderId: null, $or: [{ legalVersion: dto.version }, ...(dto.version === 0 ? [{ legalVersion: { $exists: false } }] : [])] };
    const updated = await this.model.updateOne(guard, { $set: { orderId: order._id }, $inc: { legalVersion: 1 }, $push: { linkReceipts: { uid: dto.clientUid, hash, version: dto.version + 1, at: new Date() }, versions: { at: new Date(), by: user?.username, reason: 'Связано с существующим договором', snapshot: this.snapshot(cur) } } }).exec();
    if (!updated.matchedCount) {
      const fresh = await this.find(id);
      if ((fresh.linkReceipts || []).some((r: Doc) => r.uid === dto.clientUid && r.hash === hash)) return this.get(id);
      throw new ConflictException('КП изменилось — обновите карточку');
    }
    return this.get(id);
  }

  private async ourCompany(id: string) {
    const c = await this.db().collection('organizations').findOne({ _id: oid(id, 'компании'), isOurCompany: true, deletedAt: null }, { projection: { _id: 1 } });
    if (!c) throw new BadRequestException('Выберите нашу компанию из списка');
    return c._id as Types.ObjectId;
  }

  private mapItems(items: CreateOfferDto['items']) {
    validateSourceItems(items);
    const calculated = calcTotals(items.map((i) => ({
      productId: i.productId ? oid(i.productId, 'изделия') : undefined, productName: i.productName.trim(), productSku: clean(i.productSku) || undefined, description: clean(i.description) || undefined,
      color: clean(i.color) || undefined, size: clean(i.size) || undefined, photoUrl: clean(i.photoUrl) || undefined, quantity: i.quantity, unit: clean(i.unit) || 'шт', unitPrice: i.unitPrice,
      lineKind: i.lineKind, pageBreakBefore: i.pageBreakBefore, photoMm: i.photoMm, rowMm: i.rowMm,
      sourceRowKey: i.sourceRowKey, sourceLine: i.sourceLine, scopeState: i.scopeState, exclusionReason: i.exclusionReason, exclusionConfirmedAt: i.exclusionConfirmedAt, exclusionEventDate: i.exclusionEventDate, matchStatus: i.matchStatus,
    })));
    for (const row of calculated.items) if (row.sourceLine?.lineAmount !== undefined) row.total = row.sourceLine.lineAmount;
    calculated.total = calculated.items.reduce((sum, row) => sum + cents(row.total), 0) / 100;
    return calculated;
  }

  /** `{ items, total, page, limit, counts }`; counts — по статусам для поиска `q` (без фильтра статуса) + `all`. */
  async list(q: Record<string, unknown>) {
    const p = parseList({ ...q, search: q.q ?? q.search }, { sortable: ['date', 'number', 'total', 'customer', 'createdAt', 'deletedAt'], defaultSort: '-date', defaultLimit: 50 });
    const base: Doc = p.deleted ? { deletedAt: { $ne: null } } : { deletedAt: null };
    if (p.search) base.$or = [{ number: p.search }, { customer: p.search }, { title: p.search }];
    const filter: Doc = { ...base };
    const st = clean(q.status);
    if (st) {
      if (!(OFFER_STATUSES as readonly string[]).includes(st)) throw new BadRequestException('Неизвестный статус');
      filter.status = st;
    }
    if (q.needsReview === '1') filter['legal.issues'] = { $elemMatch: { state: { $in: ['unknown', 'conflict'] } } };
    const packId = clean(q.packId);
    if (packId) filter.packId = packId;
    const opt = { includeSoftDeleted: true };
    const [rows, total, grouped] = await Promise.all([
      this.model.find(filter,{legalHistory:0,legalReceipts:0,orderConversion:0,versions:0,linkReceipts:0}).setOptions(opt).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec() as unknown as Promise<Doc[]>,
      this.model.countDocuments(filter).setOptions(opt).exec(),
      this.model.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).exec() as Promise<Array<{ _id: string; n: number }>>,
    ]);
    const counts: Record<string, number> = { all: 0, ...Object.fromEntries(OFFER_STATUSES.map((s) => [s, 0])) };
    for (const g of grouped) { counts[g._id] = g.n; counts.all += g.n; }
    // Сохраняем публичный versionCount, не передавая массивы снимков в список.
    const versionCounts=rows.length?await this.model.aggregate([{$match:{_id:{$in:rows.map(r=>r._id)}}},{$project:{versionCount:{$size:{$ifNull:['$versions',[]]}}}}]).exec() as Doc[]:[];
    const countById=new Map(versionCounts.map(r=>[String(r._id),Number(r.versionCount)]));
    for(const row of rows){const count=countById.get(String(row._id));if(count!==undefined&&Number.isFinite(count))row.versionCount=count;}
    const names = await this.companyNames(rows.map((r) => r.companyId));
    const packSizes = await this.packSizes(rows.map((r) => r.packId as string | undefined));
    return {
      items: rows.map((r) => this.present(r, names.get(String(r.companyId)) ?? null, packSizes.get(String(r.packId ?? '')) ?? null)),
      total, page: p.page, limit: p.limit, counts,
    };
  }

  private async find(id: string, session?: ClientSession): Promise<Doc> {
    const query = this.model.findOne({ _id: oid(id, 'КП') });
    if (session) query.session(session);
    const o = await query.lean().exec() as unknown as Doc | null;
    if (!o) throw new NotFoundException('КП не найдено');
    return o;
  }

  async get(id: string) {
    const o = await this.find(id);
    const packId = o.packId ? String(o.packId) : '';
    const packSizes = await this.packSizes([packId || undefined]);
    return this.present(o, await this.companyName(o.companyId), packSizes.get(packId) ?? null, true);
  }

  async create(dto: CreateOfferDto, user: AuthenticatedUser) {
    const companyId = await this.ourCompany(dto.companyId);
    const { items, total } = this.mapItems(dto.items);
    const legal = dto.initialLegal ? prepareLegal(dto.initialLegal, undefined, user?.id) : undefined;
    if (dto.items.some((i) => i.sourceLine) && !legal) throw new BadRequestException('Исходные строки сохраняются вместе с юридическим комплектом');
    if (dto.intakeUid && !legal) throw new BadRequestException('Для загрузки источника нужен юридический комплект');
    if (legal) {
      if (!dto.intakeUid) throw new BadRequestException('Укажите ключ загрузки источника');
      await assertIntakeIndexes(this.model, ['c164_offer_intake_uid', 'c164_offer_intake_key']);
      if (!dto.date || legal.sourceDate !== dto.date.slice(0, 10)) throw new BadRequestException('Сохраните исходную дату КП отдельно от даты загрузки');
      if (legal.gross !== undefined && cents(legal.gross) !== cents(total)) throw new BadRequestException('Исходный итог КП не совпадает с суммой строк');
      await validateLegalFiles(this.connection, legal);
      await validateLegalParties(this.connection, String(companyId), dto.counterpartyId, legal);
      if (dto.counterpartyId) await this.assertCounterparty(dto.counterpartyId);
    }
    const intakeKey = legal ? intakeBusinessKey(legal, 'offer') : undefined;
    const intakeHash = legal ? intakeContentHash(dto) : undefined;
    if (intakeKey) {
      const existing = await this.model.findOne({ $or: [{ intakeUid: dto.intakeUid }, { intakeKey }] }).setOptions({ includeSoftDeleted: true }).lean().exec();
      if (existing) { assertIntakeReplay(existing as unknown as Doc, intakeHash!); return this.get(String(existing._id)); }
    }
    const number = await this.counters.next('CommercialOffer', 'КП');
    const now = new Date();
    let doc;
    try { doc = await this.model.create({
      ...(legal ? { legal, legalVersion: 0, intakeUid: dto.intakeUid, intakeKey, intakeHash } : {}), sourceNumber: dto.sourceNumber, agreedTotal: agreedOfferTotal(items),
      number, date: day(dto.date), validUntil: dto.validUntil ? day(dto.validUntil) : undefined, companyId, customer: dto.customer.trim(),
      counterpartyId: dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : undefined, title: clean(dto.title) || undefined,
      status: 'draft', items, total, prepaymentPercent: dto.prepaymentPercent, productionDays: dto.productionDays, deliveryDays: dto.deliveryDays,
      objectName: clean(dto.objectName) || undefined, vatMode: dto.vatMode, vatRate: dto.vatRate, delivery: dto.delivery,
      layout: dto.layout, terms: clean(dto.terms) || undefined, notes: clean(dto.notes) || undefined, bg1Id: dto.bg1Id, bg2Id: dto.bg2Id,
      statusHistory: [{ status: 'draft', at: now, by: user?.username }],
    }); } catch (error) {
      if (intakeKey && (error as { code?: number }).code === 11000) {
        const existing = await this.model.findOne({ $or: [{ intakeUid: dto.intakeUid }, { intakeKey }] }).setOptions({ includeSoftDeleted: true }).lean().exec();
        if (existing) { assertIntakeReplay(existing as unknown as Doc, intakeHash!); return this.get(String(existing._id)); }
      }
      throw error;
    }
    return this.present(doc.toObject() as unknown as Doc, await this.companyName(companyId));
  }

  private async editedFields(cur: Doc, dto: UpdateOfferDto, editor = dto.expectedUpdatedAt !== undefined) {
    if (dto.expectedUpdatedAt !== undefined && (cur.updatedAt ? new Date(cur.updatedAt).toISOString() : null) !== dto.expectedUpdatedAt) {
      throw new ConflictException('КП изменилось — откройте актуальную версию');
    }
    this.assertNoConversion(cur);
    if (editor && dto.companyId !== undefined && String(cur.companyId) !== dto.companyId) {
      throw new BadRequestException('Для другой фирмы создайте копию КП');
    }
    if (dto.initialLegal !== undefined || dto.intakeUid !== undefined) throw new BadRequestException('Юридический комплект меняется отдельным действием с версией');
    if (cur.legal) {
      if (dto.version === undefined || dto.version !== (cur.legalVersion || 0)) throw new ConflictException('КП изменилось — откройте актуальную версию');
      if (dto.sourceNumber !== undefined && dto.sourceNumber !== cur.sourceNumber) throw new ConflictException('Исходный номер КП неизменяем');
      if (dto.companyId !== undefined && dto.companyId !== String(cur.companyId)) throw new ConflictException('Исходная компания КП неизменяема');
      if (dto.date !== undefined && dto.date?.slice(0, 10) !== String(cur.legal.sourceDate)) throw new ConflictException('Исходная дата КП неизменяема');
      if (dto.items) validateSourceItems(dto.items, cur.items);
    }
    const set: Doc = {};
    if (dto.companyId !== undefined) set.companyId = await this.ourCompany(dto.companyId);
    if (dto.customer !== undefined) set.customer = dto.customer.trim();
    if (dto.counterpartyId !== undefined) {
      if (cur.legal && dto.counterpartyId) await validateLegalParties(this.connection, String(cur.companyId), dto.counterpartyId, cur.legal);
      set.counterpartyId = dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : null;
    }
    if (dto.date !== undefined) set.date = day(dto.date);
    if (dto.validUntil !== undefined) set.validUntil = dto.validUntil ? day(dto.validUntil) : null;
    for (const k of ['title', 'terms', 'notes', 'objectName'] as const) if (dto[k] !== undefined) set[k] = clean(dto[k]) || null;
    for (const k of ['prepaymentPercent', 'productionDays', 'deliveryDays', 'bg1Id', 'bg2Id', 'vatMode', 'vatRate', 'delivery'] as const) if (dto[k] !== undefined) set[k] = dto[k] ?? null;
    if (dto.items !== undefined) { const m = this.mapItems(dto.items); set.items = m.items; set.total = m.total; }
    if (dto.layout !== undefined) set.layout = dto.layout;
    const company = set.companyId ?? cur.companyId;
    for (const [page, field] of [[1, 'bg1Id'], [2, 'bg2Id']] as const) {
      if (editor && dto[field] && dto[field] !== cur[field]) await this.bgs.assertCompanyBlank(page, dto[field], company);
    }
    return set;
  }

  async previewEdited(id: string, dto: UpdateOfferDto) {
    const cur = await this.find(id);
    const set = await this.editedFields(cur, dto, true);
    const pageMap = newOfferPageMap();
    const geometry = new OfferGeometry();
    return { buf: await this.render({ ...cur, ...set }, false, pageMap, geometry), geometry, pageMap, filename: this.pdfName(cur.number) };
  }

  async update(id: string, dto: UpdateOfferDto, user?: AuthenticatedUser) {
    const cur = await this.find(id);
    const bypass = checkEditable(cur.status, { admin: isAdminActor(user), hasOrder: !!cur.orderId });
    const reason = bypass ? overrideReason(dto.reason) : '';
    const set = await this.editedFields(cur, dto);
    if (!Object.keys(set).length) throw new BadRequestException('Нечего менять');
    const versioned = !!cur.legal || bypass || ['sent', 'accepted'].includes(String(cur.status));
    const upd: Doc = { $set: set };
    if (set.items) set.agreedTotal = agreedOfferTotal(set.items);
    if (versioned) upd.$push = { versions: { at: new Date(), by: user?.username, reason: dto.reason || 'Ручная правка КП', snapshot: this.snapshot(cur) } };
    if (cur.legal) upd.$inc = { legalVersion: 1 };
    const changed = await this.model.updateOne({ _id: cur._id, deletedAt: null, ...(dto.expectedUpdatedAt !== undefined ? { updatedAt: cur.updatedAt ?? null } : {}), ...(cur.legal ? { legalVersion: dto.version } : {}) }, upd).exec();
    if ((cur.legal || dto.expectedUpdatedAt !== undefined) && !changed.matchedCount) throw new ConflictException('КП изменилось — откройте актуальную версию');
    if (bypass) await adminOverride(this.audit, { rule: 'offer.paid_edit', entityType: 'CommercialOffer', entityId: cur._id, before: { status: cur.status, total: cur.total ?? 0, items: cur.items }, after: { fields: Object.keys(set) }, reason, actor: user });
    return this.get(id);
  }

  /** Мягкое удаление. */
  async remove(id: string) {
    const cur = await this.find(id);
    this.assertNoConversion(cur);
    const changed = await this.model.updateOne({ _id: cur._id, ...(cur.legal ? { legalVersion: cur.legalVersion || 0, 'orderConversion.status': { $ne: 'pending' } } : {}) }, { $set: { deletedAt: new Date() } }).exec();
    if (cur.legal && !changed.matchedCount) throw new ConflictException('КП изменилось — обновите карточку');
    return { id, deleted: true };
  }

  /** Вернуть из корзины. */
  async restore(id: string) {
    const r = await this.model.updateOne({ _id: oid(id, 'КП'), deletedAt: { $ne: null } }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    if (!r.matchedCount) throw new NotFoundException('В корзине такого КП нет');
    return this.get(id);
  }

  async setStatus(id: string, to: string, user: AuthenticatedUser, reasonText?: string) {
    const cur = await this.find(id);
    this.assertNoConversion(cur);
    if (!(OFFER_STATUSES as readonly string[]).includes(to)) throw new BadRequestException('Неизвестный статус');
    const bypass = checkMove(cur.status, to as OfferStatus, cur.items, { admin: isAdminActor(user), hasOrder: !!cur.orderId });
    const reason = bypass ? overrideReason(reasonText) : ''; // ЗЯ-1: недопустимый переход — только администратор и с причиной
    await this.writeStatus(cur, to, user, new Date());
    if (bypass) await adminOverride(this.audit, { rule: 'offer.status_jump', entityType: 'CommercialOffer', entityId: cur._id, before: { status: cur.status }, after: { status: to }, reason, actor: user });
    return this.get(id);
  }

  private async writeStatus(cur: Doc, to: string, user: AuthenticatedUser, at: Date, session?: ClientSession) {
    const query = this.model.updateOne(
      { _id: cur._id, deletedAt: null, status: cur.status,
        ...(cur.legal ? { legalVersion: cur.legalVersion || 0, 'orderConversion.status': { $ne: 'pending' } } : {}) },
      { $set: { status: to }, ...(cur.legal ? { $inc: { legalVersion: 1 } } : {}), $push: { statusHistory: { status: to, at, by: user?.username } } },
    );
    if (session) query.session(session);
    const changed = await query.exec();
    if (!changed.matchedCount) throw new ConflictException('КП изменилось — обновите карточку');
  }

  private async packRows(packId: string, session?: ClientSession): Promise<Doc[]> {
    const query = this.model.find({ packId, deletedAt: null });
    if (session) query.session(session);
    return query.sort({ _id: 1 }).lean().exec() as unknown as Promise<Doc[]>;
  }

  private async checkedOffers(rows: Doc[]) {
    const [names, companies, images] = await Promise.all([this.companyNames(rows.map((r) => r.companyId)), this.companies(),
      offerPhotos(this.db(), rows.flatMap((r) => r.items || []))]);
    let photoIndex = 0;
    const blank = new Map(companies.items.map((c) => [c.id, c.hasBlank]));
    const today = day();
    return rows.map((r) => ({
      id: String(r._id), number: r.number as string, status: r.status as string, customer: r.customer as string,
      companyName: names.get(String(r.companyId)) ?? null,
      problems: offerProblems(r as never, { hasBlank: !!blank.get(String(r.companyId)), photos: (r.items || []).map(() => !!images[photoIndex++]), today }),
    }));
  }

  /** C080: проверка перед отправкой — КП и (если есть) весь его пакет. Только чтение. */
  async check(id: string) {
    const cur = await this.find(id);
    const packId = clean(cur.packId);
    const offers = await this.checkedOffers(packId ? await this.packRows(packId) : [cur]);
    const own = offers.find((o) => o.id === String(cur._id));
    if (!own) throw new ConflictException('Состав пакета изменился — обновите карточку');
    const pack = packId ? packProblems(offers) : own.problems;
    return {
      offer: { problems: own.problems, ready: !own.problems.length },
      pack: packId ? { packId, size: offers.length, offers, problems: pack, ready: !pack.length } : null,
    };
  }

  /** Все черновики получают отметку одним действием. Повтор после фиксации ничего не меняет. */
  async sendPack(packId: string, user: AuthenticatedUser) {
    return this.connection.transaction(async (session) => {
      const rows = await this.packRows(clean(packId), session);
      if (!rows.length) throw new NotFoundException('Пакет не найден');
      const drafts = rows.filter((row) => row.status === 'draft');
      if (!drafts.length) return { packId, sent: 0, ids: [] as string[] };
      const problems = packProblems(await this.checkedOffers(rows));
      if (problems.length) throw new BadRequestException(`Пакет отправить нельзя: ${problems.join('; ')}`);
      const at = new Date();
      for (const row of drafts) {
        this.assertNoConversion(row);
        await this.writeStatus(row, 'sent', user, at, session);
      }
      return { packId, sent: drafts.length, ids: drafts.map((row) => String(row._id)) };
    });
  }

  /** Ставка НДС нашей фирмы (organizations.vatRate); только чтение. */
  private async companyVatRate(id: unknown): Promise<number | null> {
    const c = await this.db().collection('organizations').findOne({ _id: id as Types.ObjectId }, { projection: { vatRate: 1 } });
    return c && c.vatRate !== undefined && c.vatRate !== null ? Number(c.vatRate) : null;
  }

  /** Общая сборка PDF для сохранённого КП и предпросмотра (`draft` — без номера). */
  private async render(o: Doc, draft = false, pageMap?: OfferPageMap, geometry?: OfferGeometry): Promise<Buffer> {
    const pages = o.packId
      ? [this.bgs.resolveForPack(1, o.bg1Id, o.companyId), this.bgs.resolveForPack(2, o.bg2Id, o.companyId)] as const
      : [this.bgs.resolve(1, o.bg1Id, o.companyId), this.bgs.resolve(2, o.bg2Id, o.companyId)] as const;
    const [companyName, orgVat, bg1, bg2, photos] = await Promise.all([
      this.companyName(o.companyId), this.companyVatRate(o.companyId), ...pages,
      offerPhotos(this.db(), o.items),
    ]);
    const vat = resolveVat(o.vatMode, o.vatRate, orgVat);
    return renderOfferPdf({
      pageMap, geometry, layout: o.layout, number: o.number, draft, date: o.date, validUntil: o.validUntil, customer: o.customer, objectName: o.objectName, companyName: companyName ?? undefined,
      items: o.legal ? o.items.map((row: Doc) => row.scopeState === 'excluded' ? { ...row, productName: `Исключено: ${row.productName}`, description: [row.description, row.exclusionReason].filter(Boolean).join(' · ') } : row) : o.items, total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent, productionDays: o.productionDays, deliveryDays: o.deliveryDays,
      ...vat, delivery: o.delivery, terms: o.terms, notes: o.legal ? [o.notes, `История предложения: исходная сумма ${Number(o.total || 0).toFixed(2)}; согласованный состав ${agreedOfferTotal(o.items || []).toFixed(2)}. Исключённые позиции не входят в согласованный состав. Оригинал документа сохранён отдельно.`].filter(Boolean).join('\n') : o.notes, bg1: bg1.jpeg, bg2: bg2.jpeg, zones: { first: bg1, next: bg2 },
      photos: new Map(photos.flatMap((b, k) => (b ? [[k, b] as [number, Buffer]] : []))),
    });
  }

  private pdfName(number: string) {
    return `КП-${String(number).replace(/^КП-?/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_')}.pdf`;
  }

  async pdf(id: string) {
    const o = await this.find(id);
    const pageMap = newOfferPageMap();
    const geometry = new OfferGeometry();
    return { buf: await this.render(o, false, pageMap, geometry), geometry, pageMap, filename: this.pdfName(o.number) };
  }

  /** Предпросмотр до сохранения: тот же PDF, без записи в базу и без номера («КП-черновик»). */
  async preview(dto: CreateOfferDto) {
    const companyId = await this.ourCompany(dto.companyId);
    const { items, total } = this.mapItems(dto.items);
    const o = {
      number: 'КП-черновик', date: day(dto.date), validUntil: dto.validUntil ? day(dto.validUntil) : undefined, companyId, customer: dto.customer.trim(),
      items, total, prepaymentPercent: dto.prepaymentPercent, productionDays: dto.productionDays, deliveryDays: dto.deliveryDays,
      objectName: clean(dto.objectName) || undefined, vatMode: dto.vatMode, vatRate: dto.vatRate, delivery: dto.delivery,
      layout: dto.layout, terms: clean(dto.terms) || undefined, notes: clean(dto.notes) || undefined, bg1Id: dto.bg1Id, bg2Id: dto.bg2Id,
    };
    return { buf: await this.render(o, true), filename: 'КП-черновик.pdf' };
  }

  /**
   * Последнее не отменённое КП заказчику (C073).
   * Сначала counterpartyId, иначе точное название без регистра и лишних пробелов. Нет — null.
   * Среди свежих 40: если у заказчика больше, берём самое новое из них.
   */
  async last(q: { customer?: string; counterpartyId?: string }) {
    const customer = clean(q.customer);
    const counterpartyId = clean(q.counterpartyId);
    if (!counterpartyId && !offerCustomerKey(customer)) return null;
    const base: Doc = { deletedAt: null, status: { $ne: 'cancelled' } };
    const load = (filter: Doc) => this.model.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).limit(40).lean().exec() as unknown as Promise<LastOfferRow[]>;
    if (counterpartyId && Types.ObjectId.isValid(counterpartyId)) {
      const rows = await load({ ...base, counterpartyId: new Types.ObjectId(counterpartyId) });
      const hit = pickLastOffer(rows, { counterpartyId, customer: '' });
      if (hit) return presentLastOffer(hit);
    }
    const re = customerNameRegex(customer);
    if (!re) return null;
    const rows = await load({ ...base, customer: re });
    const hit = pickLastOffer(rows, { customer, counterpartyId: '' });
    return hit ? presentLastOffer(hit) : null;
  }

  /** Стандартные тексты и НДС для формы нового КП выбранной фирмы. */
  async defaults(companyId: string) {
    const id = await this.ourCompany(companyId);
    const [terms, orgVat] = await Promise.all([this.bgs.defaultTerms(id), this.companyVatRate(id)]);
    return { terms, ...resolveVat(undefined, undefined, orgVat) };
  }

  /** Копия КП для другой нашей фирмы: цены × (1 + наценка), округление до рубля; бланк — новой фирмы; черновик. */
  async copy(id: string, dto: OfferCopyDto, user: AuthenticatedUser) {
    const cur = await this.find(id);
    if (cur.legal) throw new BadRequestException('Историческое КП сохраняется с исходной компанией; подготовьте отдельное новое предложение');
    const companyId = await this.ourCompany(dto.companyId);
    const doc = await this.createCopyDoc(cur, companyId, dto.markupPercent ?? 0, user, null, false);
    return this.present(doc.toObject() as unknown as Doc, await this.companyName(companyId));
  }

  /**
   * Несколько копий КП для разных фирм (C071). Сначала все проверки, потом запись.
   * Исходное и копии получают общий packId; у исходного packId появляется, если его ещё не было.
   */
  async copyMany(id: string, dto: OfferCopiesDto, user: AuthenticatedUser) {
    const cur = await this.find(id);
    if (cur.legal) throw new BadRequestException('Историческое КП сохраняется с исходной компанией; подготовьте отдельное новое предложение');
    const rows = dto.companies ?? [];
    if (!rows.length) throw new BadRequestException('Отметьте хотя бы одну фирму');
    if (rows.length > 10) throw new BadRequestException('Не больше 10 фирм за раз');
    const seen = new Set<string>();
    const resolved: Array<{ companyId: Types.ObjectId; pct: number; name: string }> = [];
    for (const row of rows) {
      const cid = String(row.companyId);
      if (cid === String(cur.companyId)) throw new BadRequestException('Нельзя копировать на ту же фирму, что у исходного КП');
      if (seen.has(cid)) throw new BadRequestException('Одна фирма указана дважды — уберите повтор');
      seen.add(cid);
      const companyId = await this.ourCompany(cid);
      const name = (await this.companyName(companyId)) || 'без названия';
      if (!(await this.companyHasBlank(companyId))) {
        throw new BadRequestException(`У фирмы «${name}» нет бланка КП. Загрузите бланк: Контрагенты → Наши компании`);
      }
      resolved.push({ companyId, pct: Number(row.markupPercent ?? 0), name });
    }
    return this.connection.transaction(async (session) => {
      const fresh = await this.find(id, session);
      if (fresh.legal) throw new BadRequestException('Историческое КП сохраняется с исходной компанией; подготовьте отдельное новое предложение');
      if (String(fresh.companyId) !== String(cur.companyId)) throw new ConflictException('Компания исходного КП изменилась — обновите карточку');
      const packId = clean(fresh.packId) || randomBytes(12).toString('hex');
      const group = fresh.packId ? await this.packRows(packId, session) : [fresh];
      const byCompany = new Map(group.map((doc) => [String(doc.companyId), doc]));
      const missing = resolved.filter((row) => !byCompany.has(String(row.companyId)));
      if (missing.length) {
        // Один участник занимает пакет при добавлении фирм даже из разных карточек.
        const claimed = await this.model.updateOne({ _id: group[0]._id, deletedAt: null },
          { $set: { packId }, $inc: { __v: 1 } }, { session }).exec();
        if (!claimed.matchedCount) throw new ConflictException('Состав пакета изменился — обновите карточку');
        for (const row of missing) {
          const doc = await this.createCopyDoc(fresh, row.companyId, row.pct, user, packId, true, session);
          byCompany.set(String(row.companyId), doc.toObject() as unknown as Doc);
        }
      }
      const packSize = group.length + missing.length;
      return {
        packId,
        items: resolved.map((row) => this.present(byCompany.get(String(row.companyId))!, row.name, packSize)),
      };
    });
  }

  /**
   * C081: воронка «Новое КП» — по одному КП на фирму. Номера и черновики фиксируются одной транзакцией.
   */
  async createPack(dto: OfferPackDto, user: AuthenticatedUser) {
    if (dto.items.some((i) => i.sourceLine)) throw new BadRequestException('Исторический источник сохраняется отдельным КП с юридическим комплектом');
    const rows = dto.companies ?? [];
    if (!rows.length) throw new BadRequestException('Отметьте хотя бы одну фирму');
    if (rows.length > 10) throw new BadRequestException('Не больше 10 фирм за раз');
    if (!clean(dto.customer)) throw new BadRequestException('Укажите заказчика');
    if (!dto.items?.length) throw new BadRequestException('Добавьте хотя бы одну строку в КП');
    const base = this.mapItems(dto.items);
    const seen = new Set<string>();
    const firms: Array<{ companyId: Types.ObjectId; pct: number; name: string; defaults: Awaited<ReturnType<OffersService['defaults']>> }> = [];
    for (const row of rows) {
      const cid = String(row.companyId);
      if (seen.has(cid)) throw new BadRequestException('Одна фирма указана дважды — уберите повтор');
      seen.add(cid);
      const companyId = await this.ourCompany(cid);
      const name = (await this.companyName(companyId)) || 'без названия';
      if (!(await this.companyHasBlank(companyId))) {
        throw new BadRequestException(`У фирмы «${name}» нет бланка КП. Загрузите бланк: Контрагенты → Наши компании`);
      }
      firms.push({ companyId, pct: Number(row.markupPercent ?? 0), name, defaults: await this.defaults(cid) });
    }
    const packId = firms.length > 1 ? randomBytes(12).toString('hex') : null;
    const date = day(dto.date);
    return this.connection.transaction(async (session) => {
      const out = [];
      for (const f of firms) {
        const { items, total } = calcTotals(base.items.map((i) => ({ ...i, unitPrice: markedLinePrice(i, f.pct) })));
        const number = await this.counters.next('CommercialOffer', 'КП', undefined, session);
        const [doc] = await this.model.create([{
          number, date, validUntil: dto.validUntil ? day(dto.validUntil) : undefined, companyId: f.companyId, customer: clean(dto.customer),
          counterpartyId: dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : undefined, title: clean(dto.title) || undefined,
          status: 'draft', items, total, prepaymentPercent: dto.prepaymentPercent, productionDays: dto.productionDays, deliveryDays: dto.deliveryDays,
          objectName: clean(dto.objectName) || undefined, delivery: dto.delivery, vatMode: f.defaults.vatMode, vatRate: f.defaults.vatRate,
          terms: clean(dto.terms) || f.defaults.terms || undefined, notes: clean(dto.notes) || undefined,
          ...(packId ? { packId } : {}),
          statusHistory: [{ status: 'draft', at: new Date(), by: user?.username }],
        }], { session });
        out.push(this.present(doc.toObject() as unknown as Doc, f.name, packId ? firms.length : null));
      }
      return { packId, items: out };
    });
  }

  /**
   * Документ-копия. useDefaults — НДС и стандартные тексты новой фирмы (пакет C071);
   * одиночная копия оставляет terms исходного (как раньше).
   */
  private async createCopyDoc(
    cur: Doc, companyId: Types.ObjectId, pct: number, user: AuthenticatedUser, packId: string | null, useDefaults: boolean, session?: ClientSession,
  ) {
    const { items, total } = calcTotals((cur.items as Doc[]).map((i) => ({
      productId: i.productId, productName: i.productName, productSku: i.productSku, description: i.description, color: i.color, size: i.size, photoUrl: i.photoUrl,
      lineKind: i.lineKind, pageBreakBefore: i.pageBreakBefore, photoMm: i.photoMm, rowMm: i.rowMm,
      quantity: i.quantity, unit: i.unit || 'шт', unitPrice: markedLinePrice(i, pct),
    })));
    const number = await this.counters.next('CommercialOffer', 'КП', undefined, session);
    const date = day();
    const span = cur.validUntil ? Math.round((new Date(cur.validUntil).getTime() - new Date(cur.date).getTime()) / 86400000) : 0;
    let terms = cur.terms;
    let vatMode = cur.vatMode;
    let vatRate = cur.vatRate;
    if (useDefaults) {
      const defs = await this.defaults(String(companyId));
      terms = defs.terms || undefined;
      vatMode = defs.vatMode;
      vatRate = defs.vatRate;
    }
    const fields = {
      number, date, validUntil: span > 0 ? new Date(date.getTime() + span * 86400000) : undefined, companyId, customer: cur.customer,
      counterpartyId: cur.counterpartyId, title: cur.title, status: 'draft', items, total, prepaymentPercent: cur.prepaymentPercent,
      productionDays: cur.productionDays, deliveryDays: cur.deliveryDays, objectName: cur.objectName, delivery: cur.delivery,
      vatMode, vatRate, terms, layout: cur.layout, notes: cur.notes, copyOf: cur._id,
      ...(packId ? { packId } : {}),
      statusHistory: [{ status: 'draft', at: new Date(), by: user?.username }],
    };
    if (session) return (await this.model.create([fields], { session }))[0];
    return this.model.create(fields);
  }

  private async companyHasBlank(companyId: Types.ObjectId): Promise<boolean> {
    const n = await this.db().collection('offerbackgrounds').countDocuments({ companyId, page: 1 });
    return n > 0;
  }

  private async packSizes(packIds: Array<string | undefined | null>): Promise<Map<string, number>> {
    const ids = [...new Set(packIds.filter((p): p is string => !!p))];
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows = await this.model.aggregate<{ _id: string; n: number }>([
      { $match: { packId: { $in: ids }, deletedAt: null } },
      { $group: { _id: '$packId', n: { $sum: 1 } } },
    ]).exec();
    for (const r of rows) map.set(String(r._id), r.n);
    return map;
  }

  /** Наши фирмы для КП — все, вместе с «только для КП» (в «Деньгах» их нет); hasBlank — бланк 1-й стр. */
  async companies() {
    const [list, only] = await Promise.all([ourCompanies(this.connection, { withOffersOnly: true }), offersOnlyIds(this.db())]);
    const oids = list.map((c) => new Types.ObjectId(String(c.id)));
    const withBlank = new Set<string>();
    if (oids.length) {
      const blanks = await this.db().collection('offerbackgrounds').find(
        { companyId: { $in: oids }, page: 1 },
        { projection: { companyId: 1 } },
      ).toArray();
      for (const b of blanks) if (b.companyId) withBlank.add(String(b.companyId));
    }
    const items = list.map((c) => ({
      id: String(c.id), name: c.name, offersOnly: only.includes(String(c.id)), hasBlank: withBlank.has(String(c.id)),
    }));
    return { items, total: items.length };
  }

  /** Отметить фирму «только для КП» (настройка offers.onlyCompanyIds). */
  async setCompanyOffersOnly(id: string, offersOnly: boolean) {
    const cid = String(await this.ourCompany(id));
    const cur = await offersOnlyIds(this.db());
    const next = offersOnly ? [...new Set([...cur, cid])] : cur.filter((x) => x !== cid);
    await saveOffersOnlyIds(this.db(), next);
    return { id: cid, offersOnly };
  }
}
