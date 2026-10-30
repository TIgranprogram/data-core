import { promises as fs } from 'fs';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { CounterService } from '../counter/counter.service';
import type { CreateOfferDto, UpdateOfferDto } from './dto';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { renderOfferPdf } from './offer-pdf';
import { calcTotals, checkEditable, checkMove } from './offer-rules';
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
  ) {}

  private db() { return this.connection.db!; }

  private present(o: Doc, companyName?: string | null) {
    return {
      id: String(o._id), number: o.number, date: o.date, validUntil: o.validUntil ?? null,
      companyId: String(o.companyId), companyName: companyName ?? null,
      customer: o.customer, counterpartyId: o.counterpartyId ? String(o.counterpartyId) : null, title: o.title ?? null,
      status: o.status as OfferStatus,
      items: (o.items as Doc[]).map((i) => ({
        productId: i.productId ? String(i.productId) : null, productName: i.productName, productSku: i.productSku ?? null, description: i.description ?? null,
        color: i.color ?? null, size: i.size ?? null, photoUrl: i.photoUrl ?? null, quantity: i.quantity, unit: i.unit || 'шт', unitPrice: i.unitPrice ?? null, total: i.total ?? 0,
      })),
      total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent ?? null, productionDays: o.productionDays ?? null, deliveryDays: o.deliveryDays ?? null,
      terms: o.terms ?? null, notes: o.notes ?? null, bg1Id: o.bg1Id ?? null, bg2Id: o.bg2Id ?? null, orderId: o.orderId ? String(o.orderId) : null,
      statusHistory: (o.statusHistory as Doc[]) ?? [], createdAt: o.createdAt ?? null, updatedAt: o.updatedAt ?? null,
    };
  }

  private async companyName(id: unknown): Promise<string | null> {
    const c = await this.db().collection('organizations').findOne({ _id: id as Types.ObjectId }, { projection: { name: 1, fullName: 1 } });
    return c ? String(c.fullName || c.name || '') : null;
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
    const p = parseList({ ...q, search: q.q ?? q.search }, { sortable: ['date', 'number', 'total', 'customer', 'createdAt'], defaultSort: '-date', defaultLimit: 50 });
    const base: Doc = p.deleted ? { deletedAt: { $ne: null } } : { deletedAt: null };
    if (p.search) base.$or = [{ number: p.search }, { customer: p.search }, { title: p.search }];
    const filter: Doc = { ...base };
    const st = clean(q.status);
    if (st) {
      if (!(OFFER_STATUSES as readonly string[]).includes(st)) throw new BadRequestException('Неизвестный статус');
      filter.status = st;
    }
    const opt = { includeSoftDeleted: true };
    const [rows, total, grouped] = await Promise.all([
      this.model.find(filter).setOptions(opt).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec() as unknown as Promise<Doc[]>,
      this.model.countDocuments(filter).setOptions(opt).exec(),
      this.model.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).exec() as Promise<Array<{ _id: string; n: number }>>,
    ]);
    const counts: Record<string, number> = { all: 0, ...Object.fromEntries(OFFER_STATUSES.map((s) => [s, 0])) };
    for (const g of grouped) { counts[g._id] = g.n; counts.all += g.n; }
    return { items: rows.map((r) => this.present(r)), total, page: p.page, limit: p.limit, counts };
  }

  private async find(id: string): Promise<Doc> {
    const o = await this.model.findOne({ _id: oid(id, 'КП') }).lean().exec() as unknown as Doc | null;
    if (!o) throw new NotFoundException('КП не найдено');
    return o;
  }

  async get(id: string) {
    const o = await this.find(id);
    return this.present(o, await this.companyName(o.companyId));
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
      terms: clean(dto.terms) || undefined, notes: clean(dto.notes) || undefined, bg1Id: dto.bg1Id, bg2Id: dto.bg2Id,
      statusHistory: [{ status: 'draft', at: now, by: user?.username }],
    });
    return this.present(doc.toObject() as unknown as Doc, await this.companyName(companyId));
  }

  async update(id: string, dto: UpdateOfferDto) {
    const cur = await this.find(id);
    checkEditable(cur.status);
    const set: Doc = {};
    if (dto.companyId !== undefined) set.companyId = await this.ourCompany(dto.companyId);
    if (dto.customer !== undefined) set.customer = dto.customer.trim();
    if (dto.counterpartyId !== undefined) set.counterpartyId = dto.counterpartyId ? oid(dto.counterpartyId, 'контрагента') : null;
    if (dto.date !== undefined) set.date = day(dto.date);
    if (dto.validUntil !== undefined) set.validUntil = dto.validUntil ? day(dto.validUntil) : null;
    for (const k of ['title', 'terms', 'notes'] as const) if (dto[k] !== undefined) set[k] = clean(dto[k]) || null;
    for (const k of ['prepaymentPercent', 'productionDays', 'deliveryDays', 'bg1Id', 'bg2Id'] as const) if (dto[k] !== undefined) set[k] = dto[k] ?? null;
    if (dto.items !== undefined) { const m = this.mapItems(dto.items); set.items = m.items; set.total = m.total; }
    if (!Object.keys(set).length) throw new BadRequestException('Нечего менять');
    await this.model.updateOne({ _id: cur._id }, { $set: set }).exec();
    return this.get(id);
  }

  /** Мягкое удаление. */
  async remove(id: string) {
    const cur = await this.find(id);
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: new Date() } }).exec();
    return { id, deleted: true };
  }

  async setStatus(id: string, to: string, user: AuthenticatedUser) {
    const cur = await this.find(id);
    if (!(OFFER_STATUSES as readonly string[]).includes(to)) throw new BadRequestException('Неизвестный статус');
    checkMove(cur.status, to as OfferStatus, cur.items);
    await this.model.updateOne({ _id: cur._id }, { $set: { status: to }, $push: { statusHistory: { status: to, at: new Date(), by: user?.username } } }).exec();
    return this.get(id);
  }

  /** Фото строки для PDF: `/uploads/…` → маленький JPEG; нет файла или не картинка — null. */
  private async photo(url?: string): Promise<Buffer | null> {
    const path = safeUploadPath(url);
    if (!path) return null;
    try {
      await fs.access(path);
      return await sharp(path).flatten({ background: '#ffffff' }).resize(180, 180, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
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

  async pdf(id: string) {
    const o = await this.find(id);
    const [companyName, bg1, bg2, photos] = await Promise.all([
      this.companyName(o.companyId), this.bgs.resolve(1, o.bg1Id), this.bgs.resolve(2, o.bg2Id),
      Promise.all((o.items as Doc[]).map((i) => this.photoForItem(i))),
    ]);
    const buf = await renderOfferPdf({
      number: o.number, date: o.date, validUntil: o.validUntil, customer: o.customer, companyName: companyName ?? undefined,
      items: o.items, total: o.total ?? 0, prepaymentPercent: o.prepaymentPercent, productionDays: o.productionDays, deliveryDays: o.deliveryDays,
      terms: o.terms, notes: o.notes, bg1, bg2, photos: new Map(photos.flatMap((b, k) => (b ? [[k, b] as [number, Buffer]] : []))),
    });
    return { buf, filename: `КП-${String(o.number).replace(/^КП-?/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_')}.pdf` };
  }
}

