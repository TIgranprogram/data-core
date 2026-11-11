import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { adminOverride, isAdminActor, overrideReason } from '../../common/admin-override';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../counter/counter.service';
import { IncomesService, ourCompanies } from '../incomes/incomes.service';
import { SalesOrdersService } from '../salesorders/salesorders.service';
import { offersOnlyIds, saveOffersOnlyIds } from '../../common/offers-only';
import type { CreateOfferDto, OfferCopiesDto, OfferCopyDto, OfferCreateOrderDto, UpdateOfferDto } from './dto';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { offerProblems, packProblems } from './offer-ready';
import { renderOfferPdf } from './offer-pdf';
import { calcTotals, checkEditable, checkMove, markedUp, resolveVat } from './offer-rules';
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

  private present(o: Doc, companyName?: string | null, packSize?: number | null) {
    return {
      id: String(o._id), number: o.number, date: o.date, validUntil: o.validUntil ?? null,
      companyId: String(o.companyId), companyName: companyName ?? null,
      customer: o.customer, counterpartyId: o.counterpartyId ? String(o.counterpartyId) : null, title: o.title ?? null,
      objectName: o.objectName ?? null, vatMode: o.vatMode ?? null, vatRate: o.vatRate ?? null, delivery: o.delivery ?? null, copyOf: o.copyOf ? String(o.copyOf) : null,
      packId: o.packId ? String(o.packId) : null, packSize: packSize ?? null,
      status: o.status as OfferStatus,
      items: (o.items as Doc[]).map((i) => ({
        productId: i.productId ? String(i.productId) : null, productName: i.productName, productSku: i.productSku ?? null, description: i.description ?? null,
        color: i.color ?? null, size: i.size ?? null, photoUrl: i.photoUrl ?? null, quantity: i.quantity, unit: i.unit || 'шт', unitPrice: i.unitPrice ?? null, total: i.total ?? 0,
      })),
      total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent ?? null, productionDays: o.productionDays ?? null, deliveryDays: o.deliveryDays ?? null,
      terms: o.terms ?? null, notes: o.notes ?? null, bg1Id: o.bg1Id ?? null, bg2Id: o.bg2Id ?? null, orderId: o.orderId ? String(o.orderId) : null,
      versionCount: ((o.versions as Doc[]) ?? []).length,
      statusHistory: (o.statusHistory as Doc[]) ?? [], createdAt: o.createdAt ?? null, updatedAt: o.updatedAt ?? null,
    };
  }

  private snapshot(o: Doc) {
    return {
      customer: o.customer, companyId: String(o.companyId), title: o.title ?? null, items: o.items, total: o.total,
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
    const { value: productionNo } = await this.salesOrders.nextProductionNo({});
    const orderNo = `КП-${String(o.number).replace(/^КП-?/i, '').slice(0, 40)}`;
    return {
      offerId: String(o._id), offerNo: o.number,
      header: { orderNo, productionNo, customer: o.customer, companyId: String(o.companyId), companyName: companyName ?? '', title: `По ${o.number}`, stage: 'new' as const },
      lines: (o.items as Doc[]).map((i) => ({
        productId: i.productId ? String(i.productId) : null, title: i.productName, qty: i.quantity, unit: i.unit || 'шт', color: i.color ?? null, size: i.size ?? null,
        // цена КП идёт в позицию заказа (решение владельца 2026-11-11, C068-3); НДС в КП — внутри цены
        unitPrice: typeof i.unitPrice === 'number' && i.unitPrice > 0 ? i.unitPrice : null,
      })),
    };
  }

  async createOrder(id: string, dto: OfferCreateOrderDto, user: AuthenticatedUser) {
    const o = await this.find(id);
    this.assertOrderFromOffer(o);
    const draft = await this.toOrder(id);
    const orderNo = clean(dto.orderNo) || draft.header.orderNo;
    const productionNo = clean(dto.productionNo) || draft.header.productionNo;
    const uid = `offer-order-${String(o._id)}`;
    const head = await this.salesOrders.create({
      orderNo, productionNo, customer: o.customer, companyId: String(o.companyId), title: draft.header.title,
      stage: 'new', paymentForm: 'б/р', requireFields: true, clientUid: uid,
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

  private async ourCompany(id: string) {
    const c = await this.db().collection('organizations').findOne({ _id: oid(id, 'компании'), isOurCompany: true, deletedAt: null }, { projection: { _id: 1 } });
    if (!c) throw new BadRequestException('Выберите нашу компанию из списка');
    return c._id as Types.ObjectId;
  }

  private mapItems(items: CreateOfferDto['items']) {
    return calcTotals(items.map((i) => ({
      productId: i.productId ? oid(i.productId, 'изделия') : undefined, productName: i.productName.trim(), productSku: clean(i.productSku) || undefined, description: clean(i.description) || undefined,
      color: clean(i.color) || undefined, size: clean(i.size) || undefined, photoUrl: clean(i.photoUrl) || undefined, quantity: i.quantity, unit: clean(i.unit) || 'шт', unitPrice: i.unitPrice,
    })));
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
    const packId = clean(q.packId);
    if (packId) filter.packId = packId;
    const opt = { includeSoftDeleted: true };
    const [rows, total, grouped] = await Promise.all([
      this.model.find(filter).setOptions(opt).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec() as unknown as Promise<Doc[]>,
      this.model.countDocuments(filter).setOptions(opt).exec(),
      this.model.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).exec() as Promise<Array<{ _id: string; n: number }>>,
    ]);
    const counts: Record<string, number> = { all: 0, ...Object.fromEntries(OFFER_STATUSES.map((s) => [s, 0])) };
    for (const g of grouped) { counts[g._id] = g.n; counts.all += g.n; }
    const names = await this.companyNames(rows.map((r) => r.companyId));
    const packSizes = await this.packSizes(rows.map((r) => r.packId as string | undefined));
    return {
      items: rows.map((r) => this.present(r, names.get(String(r.companyId)) ?? null, packSizes.get(String(r.packId ?? '')) ?? null)),
      total, page: p.page, limit: p.limit, counts,
    };
  }

  private async find(id: string): Promise<Doc> {
    const o = await this.model.findOne({ _id: oid(id, 'КП') }).lean().exec() as unknown as Doc | null;
    if (!o) throw new NotFoundException('КП не найдено');
    return o;
  }

  async get(id: string) {
    const o = await this.find(id);
    const packId = o.packId ? String(o.packId) : '';
    const packSizes = await this.packSizes([packId || undefined]);
    return this.present(o, await this.companyName(o.companyId), packSizes.get(packId) ?? null);
  }

  async create(dto: CreateOfferDto, user: AuthenticatedUser) {
    const companyId = await this.ourCompany(dto.companyId);
    const { items, total } = this.mapItems(dto.items);
    const number = await this.counters.next('CommercialOffer', 'КП');
    const now = new Date();
    const doc = await this.model.create({
      number, date: day(dto.date), validUntil: dto.validUntil ? day(dto.validUntil) : undefined, companyId, customer: dto.customer.trim(),
      counterpartyId: dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : undefined, title: clean(dto.title) || undefined,
      status: 'draft', items, total, prepaymentPercent: dto.prepaymentPercent, productionDays: dto.productionDays, deliveryDays: dto.deliveryDays,
      objectName: clean(dto.objectName) || undefined, vatMode: dto.vatMode, vatRate: dto.vatRate, delivery: dto.delivery,
      terms: clean(dto.terms) || undefined, notes: clean(dto.notes) || undefined, bg1Id: dto.bg1Id, bg2Id: dto.bg2Id,
      statusHistory: [{ status: 'draft', at: now, by: user?.username }],
    });
    return this.present(doc.toObject() as unknown as Doc, await this.companyName(companyId));
  }

  async update(id: string, dto: UpdateOfferDto, user?: AuthenticatedUser) {
    const cur = await this.find(id);
    const bypass = checkEditable(cur.status, { admin: isAdminActor(user), hasOrder: !!cur.orderId });
    const reason = bypass ? overrideReason(dto.reason) : ''; // ЗЯ-1: оплаченное КП правит администратор только с причиной
    const set: Doc = {};
    if (dto.companyId !== undefined) set.companyId = await this.ourCompany(dto.companyId);
    if (dto.customer !== undefined) set.customer = dto.customer.trim();
    if (dto.counterpartyId !== undefined) set.counterpartyId = dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : null;
    if (dto.date !== undefined) set.date = day(dto.date);
    if (dto.validUntil !== undefined) set.validUntil = dto.validUntil ? day(dto.validUntil) : null;
    for (const k of ['title', 'terms', 'notes', 'objectName'] as const) if (dto[k] !== undefined) set[k] = clean(dto[k]) || null;
    for (const k of ['prepaymentPercent', 'productionDays', 'deliveryDays', 'bg1Id', 'bg2Id', 'vatMode', 'vatRate', 'delivery'] as const) if (dto[k] !== undefined) set[k] = dto[k] ?? null;
    if (dto.items !== undefined) { const m = this.mapItems(dto.items); set.items = m.items; set.total = m.total; }
    if (!Object.keys(set).length) throw new BadRequestException('Нечего менять');
    const versioned = ['sent', 'accepted'].includes(String(cur.status));
    const upd: Doc = { $set: set };
    if (versioned) upd.$push = { versions: { at: new Date(), by: user?.username, snapshot: this.snapshot(cur) } };
    await this.model.updateOne({ _id: cur._id }, upd).exec();
    if (bypass) await adminOverride(this.audit, { rule: 'offer.paid_edit', entityType: 'CommercialOffer', entityId: cur._id, before: { status: cur.status, total: cur.total ?? 0, items: cur.items }, after: { fields: Object.keys(set) }, reason, actor: user });
    return this.get(id);
  }

  /** Мягкое удаление. */
  async remove(id: string) {
    const cur = await this.find(id);
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: new Date() } }).exec();
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
    if (!(OFFER_STATUSES as readonly string[]).includes(to)) throw new BadRequestException('Неизвестный статус');
    const bypass = checkMove(cur.status, to as OfferStatus, cur.items, { admin: isAdminActor(user), hasOrder: !!cur.orderId });
    const reason = bypass ? overrideReason(reasonText) : ''; // ЗЯ-1: недопустимый переход — только администратор и с причиной
    await this.model.updateOne({ _id: cur._id }, { $set: { status: to }, $push: { statusHistory: { status: to, at: new Date(), by: user?.username } } }).exec();
    if (bypass) await adminOverride(this.audit, { rule: 'offer.status_jump', entityType: 'CommercialOffer', entityId: cur._id, before: { status: cur.status }, after: { status: to }, reason, actor: user });
    return this.get(id);
  }

  /** C080: есть ли фото у каждой строки (своё или главное у изделия витрины). */
  private async itemPhotos(items: Doc[]): Promise<boolean[]> {
    return Promise.all(items.map(async (i) => {
      if (i.photoUrl) return true;
      if (!i.productId) return false;
      const prod = await this.db().collection('showcaseitems').findOne(
        { _id: i.productId, deletedAt: null },
        { projection: { 'photo.thumb': 1, 'photo.url': 1 } },
      );
      return !!((prod as Doc | null)?.photo?.thumb || (prod as Doc | null)?.photo?.url);
    }));
  }

  /** C080: проверка перед отправкой — КП и (если есть) весь его пакет. Только чтение. */
  async check(id: string) {
    const cur = await this.find(id);
    const packId = cur.packId ? String(cur.packId) : '';
    const rows: Doc[] = packId
      ? await this.model.find({ packId, deletedAt: null }).lean().exec() as unknown as Doc[]
      : [cur];
    const [names, companies] = await Promise.all([this.companyNames(rows.map((r) => r.companyId)), this.companies()]);
    const blank = new Map(companies.items.map((c) => [c.id, c.hasBlank]));
    const today = day();
    const offers = await Promise.all(rows.map(async (r) => ({
      id: String(r._id), number: r.number as string, status: r.status as string, customer: r.customer as string,
      companyName: names.get(String(r.companyId)) ?? null,
      problems: offerProblems(r as never, { hasBlank: !!blank.get(String(r.companyId)), photos: await this.itemPhotos((r.items as Doc[]) ?? []), today }),
    })));
    const own = offers.find((o) => o.id === String(cur._id))!;
    const pack = packId ? packProblems(offers) : own.problems;
    return {
      offer: { problems: own.problems, ready: !own.problems.length },
      pack: packId ? { packId, size: offers.length, offers, problems: pack, ready: !pack.length } : null,
    };
  }

  /** C080: «Отправить пакет» — все черновики пакета → «Отправлено»; есть замечания — 400 со списком, ничего не меняем. */
  async sendPack(packId: string, user: AuthenticatedUser) {
    const first = await this.model.findOne({ packId: clean(packId), deletedAt: null }).lean().exec() as unknown as Doc | null;
    if (!first) throw new NotFoundException('Пакет не найден');
    const { pack } = await this.check(String(first._id));
    if (!pack!.ready) throw new BadRequestException(`Пакет отправить нельзя: ${pack!.problems.join('; ')}`);
    const sent: string[] = [];
    for (const o of pack!.offers.filter((x) => x.status === 'draft')) {
      await this.setStatus(o.id, 'sent', user);
      sent.push(o.id);
    }
    return { packId, sent: sent.length, ids: sent };
  }

  /** Фото строки для PDF: `/uploads/…` → маленький JPEG; нет файла или не картинка — null. */
  private async photo(url?: string): Promise<Buffer | null> {
    const path = safeUploadPath(url);
    if (!path) return null;
    try {
      await fs.access(path);
      return await sharp(path).flatten({ background: '#ffffff' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    } catch { return null; }
  }

  /** Фото для строки КП: сначала сохранённый photoUrl, затем главное фото изделия по productId. */
  private async photoForItem(item: Doc): Promise<Buffer | null> {
    if (item.photoUrl) return this.photo(item.photoUrl as string);
    if (!item.productId) return null;
    const prod = await this.db().collection('showcaseitems').findOne(
      { _id: item.productId, deletedAt: null },
      { projection: { 'photo.thumb': 1, 'photo.url': 1 } },
    );
    const url = (prod as Doc | null)?.photo?.thumb || (prod as Doc | null)?.photo?.url;
    return url ? this.photo(url as string) : null;
  }

  /** Ставка НДС нашей фирмы (organizations.vatRate); только чтение. */
  private async companyVatRate(id: unknown): Promise<number | null> {
    const c = await this.db().collection('organizations').findOne({ _id: id as Types.ObjectId }, { projection: { vatRate: 1 } });
    return c && c.vatRate !== undefined && c.vatRate !== null ? Number(c.vatRate) : null;
  }

  /** Общая сборка PDF для сохранённого КП и предпросмотра (`draft` — без номера). */
  private async render(o: Doc, draft = false): Promise<Buffer> {
    const [companyName, orgVat, bg1, bg2, photos] = await Promise.all([
      this.companyName(o.companyId), this.companyVatRate(o.companyId), this.bgs.resolve(1, o.bg1Id, o.companyId), this.bgs.resolve(2, o.bg2Id, o.companyId),
      Promise.all((o.items as Doc[]).map((i) => this.photoForItem(i))),
    ]);
    const vat = resolveVat(o.vatMode, o.vatRate, orgVat);
    return renderOfferPdf({
      number: o.number, draft, date: o.date, validUntil: o.validUntil, customer: o.customer, objectName: o.objectName, companyName: companyName ?? undefined,
      items: o.items, total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent, productionDays: o.productionDays, deliveryDays: o.deliveryDays,
      ...vat, delivery: o.delivery, terms: o.terms, notes: o.notes, bg1: bg1.jpeg, bg2: bg2.jpeg, zones: { first: bg1, next: bg2 },
      photos: new Map(photos.flatMap((b, k) => (b ? [[k, b] as [number, Buffer]] : []))),
    });
  }

  async pdf(id: string) {
    const o = await this.find(id);
    return { buf: await this.render(o), filename: `КП-${String(o.number).replace(/^КП-?/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_')}.pdf` };
  }

  /** Предпросмотр до сохранения: тот же PDF, без записи в базу и без номера («КП-черновик»). */
  async preview(dto: CreateOfferDto) {
    const companyId = await this.ourCompany(dto.companyId);
    const { items, total } = this.mapItems(dto.items);
    const o = {
      number: 'КП-черновик', date: day(dto.date), validUntil: dto.validUntil ? day(dto.validUntil) : undefined, companyId, customer: dto.customer.trim(),
      items, total, prepaymentPercent: dto.prepaymentPercent, productionDays: dto.productionDays, deliveryDays: dto.deliveryDays,
      objectName: clean(dto.objectName) || undefined, vatMode: dto.vatMode, vatRate: dto.vatRate, delivery: dto.delivery,
      terms: clean(dto.terms) || undefined, notes: clean(dto.notes) || undefined, bg1Id: dto.bg1Id, bg2Id: dto.bg2Id,
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
    let packId = cur.packId ? String(cur.packId) : '';
    if (!packId) {
      packId = randomBytes(12).toString('hex');
      await this.model.updateOne({ _id: cur._id }, { $set: { packId } }).exec();
      cur.packId = packId;
    }
    const created: Array<{ doc: { toObject: () => Doc }; companyId: Types.ObjectId }> = [];
    for (const row of resolved) {
      const doc = await this.createCopyDoc(cur, row.companyId, row.pct, user, packId, true);
      created.push({ doc, companyId: row.companyId });
    }
    const packSize = await this.packSizeOf(packId);
    const items = [];
    for (const c of created) {
      items.push(this.present(c.doc.toObject() as Doc, await this.companyName(c.companyId), packSize));
    }
    return { packId, items };
  }

  /**
   * Документ-копия. useDefaults — НДС и стандартные тексты новой фирмы (пакет C071);
   * одиночная копия оставляет terms исходного (как раньше).
   */
  private async createCopyDoc(
    cur: Doc, companyId: Types.ObjectId, pct: number, user: AuthenticatedUser, packId: string | null, useDefaults: boolean,
  ) {
    const { items, total } = calcTotals((cur.items as Doc[]).map((i) => ({
      productId: i.productId, productName: i.productName, productSku: i.productSku, description: i.description, color: i.color, size: i.size, photoUrl: i.photoUrl,
      quantity: i.quantity, unit: i.unit || 'шт', unitPrice: i.unitPrice === null || i.unitPrice === undefined ? i.unitPrice : markedUp(i.unitPrice, pct),
    })));
    const number = await this.counters.next('CommercialOffer', 'КП');
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
    return this.model.create({
      number, date, validUntil: span > 0 ? new Date(date.getTime() + span * 86400000) : undefined, companyId, customer: cur.customer,
      counterpartyId: cur.counterpartyId, title: cur.title, status: 'draft', items, total, prepaymentPercent: cur.prepaymentPercent,
      productionDays: cur.productionDays, deliveryDays: cur.deliveryDays, objectName: cur.objectName, delivery: cur.delivery,
      vatMode, vatRate, terms, notes: cur.notes, copyOf: cur._id,
      ...(packId ? { packId } : {}),
      statusHistory: [{ status: 'draft', at: new Date(), by: user?.username }],
    });
  }

  private async companyHasBlank(companyId: Types.ObjectId): Promise<boolean> {
    const n = await this.db().collection('offerbackgrounds').countDocuments({ companyId, page: 1 });
    return n > 0;
  }

  private async packSizeOf(packId: string): Promise<number> {
    if (!packId) return 0;
    return this.model.countDocuments({ packId, deletedAt: null }).exec();
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
