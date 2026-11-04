import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid, parseList } from '../../common/list-query';
import { loadPhotos } from '../../common/photos';
import { checkLine } from '../incomes/line-type';
import { aliasKey } from '../matching/matching-rules';
import { ShowcaseService } from '../showcase/showcase.service';
import { ZonesService } from '../zones/zones.service';
import type { CreateProductRequestDto } from './dto';
import { mergePhotoIds, qtySum, requestKey, similarRequests } from './product-request-rules';
import { ProductRequest, ProductRequestDocument } from './product-request.schema';

type Doc = Record<string, unknown>;
const uid = (id?: string) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);

/**
 * Заявки на создание нового изделия (ORDER-LINES). Менеджер добавляет в заказ «Новое изделие» — позиция получает `productRequestId`;
 * проектировщик подтверждает (создаётся изделие в «Продукции», позиции привязываются) или отклоняет как дубль (позиции переходят на
 * существующее изделие). Пишет `productrequests` и поля сопоставления в `incomes`; в `products` — только через ShowcaseService.create.
 */
@Injectable()
export class ProductRequestsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ProductRequest.name) private readonly model: Model<ProductRequestDocument>,
    private readonly showcase: ShowcaseService,
    @Optional() private readonly zones?: ZonesService,
  ) {}

  private get db() { return this.connection.db!; }

  /** Живые позиции заявки (без отменённых и удалённых). */
  private lines(requestId: Types.ObjectId) {
    return this.db.collection('incomes').find({ productRequestId: requestId, deletedAt: null, cancelledAt: null }).sort({ createdAt: 1, _id: 1 }).toArray() as Promise<Doc[]>;
  }

  /** Пересчитать qtyTotal заявки (после добавления/правки/удаления позиции). */
  async recalc(requestId: unknown): Promise<void> {
    if (!requestId) return;
    const _id = requestId as Types.ObjectId;
    await this.model.updateOne({ _id }, { $set: { qtyTotal: qtySum(await this.lines(_id)) } }).exec();
  }

  /**
   * Привязать позицию к открытой заявке с тем же названием (нет — создать). Позиция становится «Новым изделием»:
   * изделие и прежнее сопоставление снимаются. Нужны количество и цена. Возвращает заявку и признак `created`.
   */
  async attachIncome(income: Doc, userId?: string): Promise<{ id: Types.ObjectId; created: boolean }> {
    checkLine('new_product', (k) => (k === 'productId' ? undefined : income[k]));
    const title = String(income.title).trim();
    const key = requestKey(title);
    if (!key) throw new BadRequestException('Укажите наименование');
    const photos = ((income.photoIds as Types.ObjectId[] | undefined) ?? []);
    let req = (await this.model.findOne({ status: 'open', titleKey: key }).lean().exec()) as (ProductRequest & { _id: Types.ObjectId }) | null;
    let created = false;
    if (!req) {
      const doc = await this.model.create({ title, titleKey: key, description: String(income.notes ?? '').trim() || undefined, photoIds: photos, status: 'open', createdBy: uid(userId) });
      req = doc.toObject() as unknown as ProductRequest & { _id: Types.ObjectId };
      created = true;
    } else {
      const merged = mergePhotoIds(req.photoIds ?? [], photos).map((x) => new Types.ObjectId(x));
      const set: Doc = { photoIds: merged };
      if (!req.description && String(income.notes ?? '').trim()) set.description = String(income.notes).trim();
      await this.model.updateOne({ _id: req._id }, { $set: set }).exec();
    }
    const prev = income.productRequestId as Types.ObjectId | undefined;
    await this.db.collection('incomes').updateOne({ _id: income._id as Types.ObjectId }, {
      $set: { lineType: 'new_product', productRequestId: req!._id, editedInApp: true },
      $unset: { productId: '', matchStatus: '', matchedAt: '', matchedBy: '', serviceId: '', workTypeId: '' },
    });
    await this.recalc(req!._id);
    if (prev && String(prev) !== String(req!._id)) await this.recalc(prev);
    if (created) await this.notifyDesign(title, String(income.orderNo ?? ''), userId);
    return { id: req!._id as Types.ObjectId, created };
  }

  private async notifyDesign(title: string, orderNo: string, userId?: string) {
    await this.zones?.notifyZone('design', {
      type: 'product_request',
      text: `Новая заявка на создание изделия: «${title}»${orderNo ? `, заказ ${orderNo}` : ''}`,
      href: '#design?tab=requests',
    }, { actorId: userId }).catch(() => undefined);
  }

  /** Создать заявку из позиции (`incomeId`) или по названию; то же название — та же открытая заявка. */
  async create(dto: CreateProductRequestDto, userId?: string) {
    if (dto.incomeId) {
      const inc = await this.db.collection('incomes').findOne({ _id: oid(dto.incomeId, 'позиции'), deletedAt: null }) as Doc | null;
      if (!inc) throw new NotFoundException('Позиция не найдена');
      const r = await this.attachIncome(inc, userId);
      return { ...(await this.get(String(r.id))), created: r.created, similar: await this.similar(String(requestKey(inc.title)), String(r.id)) };
    }
    const title = String(dto.title ?? '').trim();
    const key = requestKey(title);
    if (!key) throw new BadRequestException('Укажите название нового изделия');
    const open = await this.model.findOne({ status: 'open', titleKey: key }).lean().exec();
    if (open) return { ...(await this.get(String(open._id))), created: false, similar: await this.similar(key, String(open._id)) };
    const doc = await this.model.create({ title, titleKey: key, description: dto.description?.trim() || undefined, photoIds: (dto.photoIds ?? []).map((x) => new Types.ObjectId(x)), status: 'open', createdBy: uid(userId) });
    await this.notifyDesign(title, '', userId);
    return { ...(await this.get(String(doc._id))), created: true, similar: await this.similar(key, String(doc._id)) };
  }

  /** Подсказка «это то же изделие?»: открытые заявки с похожим названием. */
  private async similar(key: string, exceptId: string) {
    const open = await this.model.find({ status: 'open' }).select('title titleKey').lean().exec();
    return similarRequests(key, open.filter((r) => String(r._id) !== exceptId)).map((r) => ({ id: String(r._id), title: r.title }));
  }

  async count() {
    return { open: await this.model.countDocuments({ status: 'open' }).exec() };
  }

  /** Список: `status` open (умолч.) | confirmed | rejected | all; `search` — по названию. */
  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['createdAt', 'title'], defaultSort: '-createdAt', defaultLimit: 50 });
    const st = String(q.status ?? 'open');
    const filter: Doc = { deletedAt: null };
    if (st !== 'all') filter.status = ['open', 'confirmed', 'rejected'].includes(st) ? st : 'open';
    const needle = String(q.search ?? q.q ?? '').trim();
    if (needle) filter.title = new RegExp(escapeRe(needle), 'i');
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    const ids = docs.map((d) => d._id);
    const agg = ids.length ? await this.db.collection('incomes').aggregate([
      { $match: { productRequestId: { $in: ids }, deletedAt: null, cancelledAt: null } },
      { $group: { _id: '$productRequestId', lines: { $sum: 1 }, qty: { $sum: { $ifNull: ['$qty', 0] } }, orders: { $addToSet: '$orderId' }, orderNos: { $addToSet: '$orderNo' } } },
    ]).toArray() : [];
    const by = new Map(agg.map((a) => [String(a._id), a]));
    const photos = await loadPhotos(this.db, docs.map((d) => d.photoIds?.[0]).filter(Boolean) as Types.ObjectId[]);
    return {
      items: docs.map((d) => {
        const a = by.get(String(d._id));
        const ph = d.photoIds?.[0] ? photos.get(String(d.photoIds[0])) : undefined;
        return {
          id: String(d._id), _id: String(d._id), title: d.title, description: d.description ?? null, status: d.status, productId: d.productId ? String(d.productId) : null,
          qtyTotal: a ? Number(a.qty) : 0, lineCount: a?.lines ?? 0, orderCount: (a?.orders as unknown[] | undefined)?.filter(Boolean).length ?? 0,
          orderNos: ((a?.orderNos as string[] | undefined) ?? []).filter(Boolean).sort(), photo: ph ? { url: ph.url, thumb: ph.thumb } : null,
          createdBy: d.createdBy ? String(d.createdBy) : null, createdAt: d.createdAt ?? null, confirmedAt: d.confirmedAt ?? null,
        };
      }),
      total, page: p.page, limit: p.limit,
    };
  }

  /** Карточка заявки: позиции и заказы, где она встречается (без цен). */
  async get(id: string) {
    const req = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }).lean().exec();
    if (!req) throw new NotFoundException('Заявка не найдена');
    const lines = await this.lines(req._id);
    const photoIds = mergePhotoIds(req.photoIds ?? [], lines.flatMap((l) => (l.photoIds as unknown[] | undefined) ?? [])).map((x) => new Types.ObjectId(x));
    const photos = await loadPhotos(this.db, photoIds);
    const orderIds = [...new Set(lines.map((l) => String(l.orderId ?? '')).filter(Boolean))];
    const orders = orderIds.length ? await this.db.collection('salesorders').find({ _id: { $in: orderIds.map((x) => new Types.ObjectId(x)) } }, { projection: { orderNo: 1, customer: 1, productionNo: 1 } }).toArray() : [];
    return {
      id: String(req._id), _id: String(req._id), title: req.title, description: req.description ?? null, status: req.status,
      productId: req.productId ? String(req.productId) : null, qtyTotal: qtySum(lines), createdBy: req.createdBy ? String(req.createdBy) : null,
      createdAt: req.createdAt ?? null, confirmedAt: req.confirmedAt ?? null,
      photos: photoIds.map((p) => photos.get(String(p))).filter(Boolean),
      lines: lines.map((l) => ({ id: String(l._id), orderId: l.orderId ? String(l.orderId) : null, orderNo: (l.orderNo as string | undefined) ?? null, customer: (l.customer as string | undefined) ?? null, title: l.title, qty: l.qty ?? null, unit: l.unit ?? null })),
      orders: orders.map((o) => ({ id: String(o._id), orderNo: o.orderNo ?? null, customer: o.customer ?? null, productionNo: o.productionNo ?? null })),
    };
  }

  private async open(id: string) {
    const req = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }).lean().exec();
    if (!req) throw new NotFoundException('Заявка не найдена');
    if (req.status !== 'open') throw new ConflictException(req.status === 'confirmed' ? 'Заявка уже подтверждена' : 'Заявка уже закрыта как дубль');
    return req;
  }

  /** Все позиции заявки → изделие: подтверждено, тип «Изделие»; формулировка запоминается (productaliases). */
  private async link(requestId: Types.ObjectId, productId: Types.ObjectId, userId?: string) {
    const lines = await this.lines(requestId);
    const now = new Date();
    const by = uid(userId);
    await this.db.collection('incomes').updateMany({ productRequestId: requestId, deletedAt: null }, { $set: { productId, matchStatus: 'confirmed', matchedAt: now, lineType: 'product', editedInApp: true, ...(by ? { matchedBy: by } : {}) } });
    for (const key of new Set(lines.map((l) => aliasKey(l.title)).filter(Boolean))) {
      await this.db.collection('productaliases').updateOne({ key }, { $set: { productId, lastAt: now, updatedAt: now }, $inc: { count: 1 }, $setOnInsert: { createdAt: now } }, { upsert: true });
    }
    return lines.length;
  }

  /**
   * Подтвердить: создаётся изделие в «Продукции» (поля как в «+ Создать изделие»: артикул, группа, раздел, паспорт…;
   * название, описание, фото, цена по умолчанию — из заявки), позиции привязываются.
   */
  async confirm(id: string, body: Doc, userId?: string) {
    const req = await this.open(id);
    const now = new Date();
    const claim = await this.model.updateOne({ _id: req._id, status: 'open' }, { $set: { status: 'confirmed', confirmedAt: now, confirmedBy: uid(userId) } }).exec();
    if (!claim.matchedCount) throw new ConflictException('Заявку уже обработали, обновите список');
    try {
      const lines = await this.lines(req._id);
      const price = lines.map((l) => Number(l.unitPrice)).find((x) => x > 0);
      const photoIds = mergePhotoIds(req.photoIds ?? [], lines.flatMap((l) => (l.photoIds as unknown[] | undefined) ?? []));
      const product = await this.showcase.create({
        name: req.title, ...(req.description ? { description: req.description } : {}), ...(photoIds.length ? { photoIds } : {}), ...(price ? { price } : {}),
        ...body,
      }, { requireType: true }) as Doc;
      const productId = new Types.ObjectId(String(product.id ?? product._id));
      await this.model.updateOne({ _id: req._id }, { $set: { productId } }).exec();
      const linked = await this.link(req._id, productId, userId);
      return { ...(await this.get(id)), linked, product };
    } catch (e) {
      await this.model.updateOne({ _id: req._id }, { $set: { status: 'open' }, $unset: { confirmedAt: '', confirmedBy: '' } }).exec();
      throw e;
    }
  }

  /** «Это дубль»: изделие не создаётся, позиции заявки переходят на существующее изделие. */
  async reject(id: string, productId: string, userId?: string) {
    const req = await this.open(id);
    const pid = oid(productId, 'изделия');
    if (!(await this.db.collection('products').findOne({ _id: pid, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Изделие не найдено — выберите из списка');
    const claim = await this.model.updateOne({ _id: req._id, status: 'open' }, { $set: { status: 'rejected', productId: pid, confirmedAt: new Date(), confirmedBy: uid(userId) } }).exec();
    if (!claim.matchedCount) throw new ConflictException('Заявку уже обработали, обновите список');
    const linked = await this.link(req._id, pid, userId);
    return { ...(await this.get(id)), linked };
  }
}
