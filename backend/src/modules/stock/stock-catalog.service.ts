import { photoToFront } from '../../common/photo-main';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { normText } from '../../common/text/norm-text';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid } from '../../common/list-query';
import { isUsedByCrm, isUsedInComposition } from '../../common/catalog/catalog-references';
import { CounterService } from '../counter/counter.service';
import { Material, MaterialDocument } from '../material/material.schema';
import { type ArticleDecision, decideArticle, isAutoArticle } from './article';
import { CategoryResolver } from '../../common/catalog/category-resolver';
import { mergeDims } from './metal';
import { StockCoreService } from './stock-core.service';
import { StockSearchService } from './stock-search.service';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import type { StockItemInput } from './stock.types';

/** Карточка позиции: создание, правка, фото, корзина, артикулы. */
@Injectable()
export class StockCatalogService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly counter: CounterService,
    private readonly core: StockCoreService,
    private readonly search: StockSearchService,
  ) {}

  /** Материал с таким же наименованием (без учёта регистра и лишних пробелов). */
  async findMaterialByName(name: string): Promise<MaterialDocument | null> {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    const re = new RegExp(`^\\s*${escapeRe(clean).replace(/ /g, '\\s+')}\\s*$`, 'i');
    return this.materials.findOne({ name: re, deletedAt: null }).exec();
  }

  /** Авто-артикул для позиции без артикула (в CRM поле обязательно): СКЛ-<год>-<номер>. */
  autoArticle() {
    return this.counter.next('MaterialArticle', 'СКЛ');
  }

  /** Внутренний код по префиксу категории — как MaterialService. */
  async skuFor(categoryId?: Types.ObjectId): Promise<string | undefined> {
    if (!categoryId) return undefined;
    const cat = await this.connection.db!.collection('categories').findOne({ _id: categoryId });
    return cat?.skuPrefix ? this.counter.next('Material', String(cat.skuPrefix)) : undefined;
  }

  /** Новая позиция: материал + строка остатка (0). Позиция с тем же наименованием не дублируется. */
  /** СМ.4: все позиции — из категорий роли, иначе 403. */
  async assertInScope(materialIds: string[], scope: string[]) {
    const ids = [...new Set(materialIds)].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const mats = await this.materials.find({ _id: { $in: ids } }, { categoryId: 1 }).lean().exec();
    if (mats.some((m) => !scope.includes(String(m.categoryId)))) throw new ForbiddenException('Эта позиция не из вашего раздела склада');
  }

  /** СМ.4: новая позиция роли — только в её категории; категория не указана — первая своя. */
  async scopeNewItem(dto: StockItemInput, scope: string[]): Promise<StockItemInput> {
    if (dto.categoryId) { if (scope.includes(String(dto.categoryId))) return dto; throw new ForbiddenException('Эта категория не из вашего раздела склада'); }
    if (!dto.categoryName?.trim()) return { ...dto, categoryId: scope[0] };
    const own = await this.connection.db!.collection('categories').find({ _id: { $in: scope.map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1 } }).toArray();
    const hit = own.find((c) => normText(c.name) === normText(dto.categoryName));
    if (!hit) throw new ForbiddenException('Эта категория не из вашего раздела склада');
    return { ...dto, categoryId: String(hit._id) };
  }

  async createItem(dto: StockItemInput) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Укажите наименование');
    const existing = await this.findMaterialByName(name);
    if (!existing && dto.article?.trim()) await this.assertArticleFree(dto.article.trim());
    if (existing) {
      // ТИ-8: уже заполненное «название в счёте» не затираем
      const keepInvoice = (existing as { invoiceName?: string }).invoiceName;
      await this.updateItem(String(existing._id), { ...dto, name: undefined, ...(keepInvoice ? { invoiceName: undefined } : {}) });
      return this.search.getItem(String(existing._id));
    }
    const categoryId = dto.categoryId && Types.ObjectId.isValid(dto.categoryId)
      ? new Types.ObjectId(dto.categoryId)
      : await new CategoryResolver(this.connection).resolve(dto.categoryName);
    const mat = await this.materials.create({
      name, unit: dto.unit?.trim() || 'шт', article: dto.article?.trim() || (await this.autoArticle()),
      sku: await this.skuFor(categoryId), categoryId, notes: dto.notes, weightKg: dto.weightKg,
      ...(dto.fullName?.trim() ? { fullName: dto.fullName.trim() } : {}), ...(dto.invoiceName?.trim() ? { invoiceName: dto.invoiceName.trim() } : {}),
      ...(dto.assortment?.trim() ? { assortment: dto.assortment.trim() } : {}), ...(dto.materialGrade?.trim() ? { materialGrade: dto.materialGrade.trim() } : {}),
      ...(dto.dims ? { dimensions: mergeDims([], dto.dims) } : {}),
      ...(typeof dto.washed === 'boolean' ? { washed: dto.washed } : {}),
    });
    if (dto.weightG !== undefined) await this.core.setWeightG(mat._id as Types.ObjectId, dto.weightG);
    const wh = await this.core.defaultWarehouse();
    await this.storage.updateOne(
      { warehouseId: wh._id, materialId: mat._id, zoneName: null },
      { $setOnInsert: { warehouseId: wh._id, materialId: mat._id, quantity: 0, reservedQty: 0, isActive: true, deletedAt: null, photos: [] },
        $set: { minQuantity: dto.minQuantity ?? 0, ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}) } },
      { upsert: true },
    ).exec();
    return this.search.getItem(String(mat._id));
  }

  async updateItem(materialId: string, dto: StockItemInput) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const _id = new Types.ObjectId(materialId);
    const mat = await this.materials.findOne({ _id, deletedAt: null }).exec();
    if (!mat) throw new NotFoundException('Позиция не найдена');
    const set: Record<string, unknown> = {};
    if (dto.name?.trim()) set.name = dto.name.trim();
    if (dto.unit?.trim()) set.unit = dto.unit.trim();
    if (dto.article?.trim() && dto.article.trim() !== mat.article) {
      // АР.3: артикул уникален; прежний автоартикул остаётся внутренним кодом; откуда — «вручную»
      await this.assertArticleFree(dto.article.trim(), _id);
      set.article = dto.article.trim();
      await this.connection.db!.collection('materials').updateOne({ _id }, { $set: { articleSource: 'вручную', articleSetAt: new Date(), ...(isAutoArticle(mat.article) && mat.article ? { internalArticle: mat.article } : {}) } });
    }
    if (dto.notes !== undefined) set.notes = dto.notes;
    if (dto.fullName !== undefined) set.fullName = dto.fullName.trim() || null;
    if (dto.invoiceName !== undefined) set.invoiceName = dto.invoiceName.trim() || null;
    if (dto.weightKg !== undefined) set.weightKg = dto.weightKg;
    for (const k of ['assortment', 'materialGrade'] as const) if (dto[k] !== undefined) set[k] = dto[k]?.trim() || null;
    if (dto.washed !== undefined) set.washed = dto.washed;
    if (dto.dims) set.dimensions = mergeDims(mat.dimensions, dto.dims);
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) set.categoryId = new Types.ObjectId(dto.categoryId);
    else if (dto.categoryName) set.categoryId = await new CategoryResolver(this.connection).resolve(dto.categoryName);
    if (Object.keys(set).length) await this.materials.updateOne({ _id }, { $set: set }).exec();
    if (dto.weightG !== undefined) await this.core.setWeightG(_id, dto.weightG);
    await this.core.markEdited(_id);
    if (dto.minQuantity !== undefined || dto.weightKg !== undefined) {
      const wh = await this.core.defaultWarehouse();
      await this.storage.updateOne(
        { warehouseId: wh._id, materialId: _id, zoneName: null },
        { $setOnInsert: { warehouseId: wh._id, materialId: _id, quantity: 0, reservedQty: 0, isActive: true, deletedAt: null, photos: [] },
          $set: { ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity ?? 0 } : {}), ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}) } },
        { upsert: true },
      ).exec();
    }
    return this.search.getItem(materialId);
  }

  async addPhoto(materialId: string, photoId: string) {
    if (!Types.ObjectId.isValid(materialId) || !Types.ObjectId.isValid(photoId)) throw new BadRequestException('Некорректный id');
    const _id = new Types.ObjectId(materialId);
    const pid = new Types.ObjectId(photoId);
    const res = await this.materials.updateOne({ _id, deletedAt: null }, { $addToSet: { photoIds: pid } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Позиция не найдена');
    await this.materials.updateOne({ _id, $or: [{ mainPhotoId: null }, { mainPhotoId: { $exists: false } }] }, { $set: { mainPhotoId: pid } }).exec();
    return this.search.getItem(materialId);
  }

  /** Сделать фото главным: первое в списке и mainPhotoId (его читает CRM). */
  async mainPhoto(materialId: string, photoId: string) {
    const _id = oid(materialId, 'позиции'); const pid = oid(photoId, 'фото');
    await photoToFront((f, u) => this.materials.updateOne(f, u).exec(), { _id, deletedAt: null }, pid);
    await this.materials.updateOne({ _id }, { $set: { mainPhotoId: pid } }).exec();
    await this.core.markEdited(_id);
    return this.search.getItem(materialId);
  }

  async removePhoto(materialId: string, photoId: string) {
    const _id = oid(materialId, 'позиции'); const pid = oid(photoId, 'фото');
    const m = await this.materials.findOne({ _id, deletedAt: null }, { photoIds: 1, mainPhotoId: 1 }).lean().exec();
    if (!m) throw new NotFoundException('Позиция не найдена');
    const rest = ((m.photoIds ?? []) as Types.ObjectId[]).filter((p) => String(p) !== String(pid));
    const main = String(m.mainPhotoId ?? '') === String(pid) ? rest[0] ?? null : m.mainPhotoId ?? null;
    await this.materials.updateOne({ _id }, { $set: { photoIds: rest, mainPhotoId: main } }).exec();
    await this.core.markEdited(_id);
    return this.search.getItem(materialId);
  }
  /** Артикул уже у другой позиции — 409 с её названием (АР.3: артикул уникален в общей схеме). */
  private async assertArticleFree(article: string, self?: Types.ObjectId) {
    const twin = await this.materials.findOne({ article: new RegExp(`^\\s*${escapeRe(article)}\\s*$`, 'i'), deletedAt: null, ...(self ? { _id: { $ne: self } } : {}) }, { name: 1 }).lean().exec();
    if (twin) throw new ConflictException(`Артикул «${article}» уже у позиции «${twin.name}» — это одна и та же позиция? Тогда объедините их или поправьте артикул`);
  }

  /**
   * Артикул из заявки / листа в позицию (АР.2): только если у позиции пусто или автоартикул СКЛ-… (он остаётся
   * внутренним кодом); свой артикул позиции не перезаписывается (расхождение — в «Требуют заполнения», fill-audit).
   * source — откуда: «заявка №14», «Google-таблица, лист «Склад»».
   */
  async adoptArticle(materialId: Types.ObjectId | string, incoming: unknown, source: string): Promise<ArticleDecision> {
    if (!materialId || !Types.ObjectId.isValid(String(materialId))) return 'skip';
    const _id = new Types.ObjectId(String(materialId));
    const db = this.connection.db!;
    const mat = await db.collection('materials').findOne({ _id, deletedAt: null }, { projection: { article: 1 } });
    if (!mat) return 'skip';
    const inc = String(incoming ?? '').trim();
    const taken = inc && !isAutoArticle(inc) ? !!(await db.collection('materials').findOne({ _id: { $ne: _id }, deletedAt: null, article: new RegExp(`^\\s*${escapeRe(inc)}\\s*$`, 'i') }, { projection: { _id: 1 } })) : false;
    const d = decideArticle(mat.article, inc, taken);
    if (d !== 'set') return d;
    try {
      await db.collection('materials').updateOne({ _id }, { $set: { article: inc, articleSource: source, articleSetAt: new Date(), ...(mat.article ? { internalArticle: mat.article } : {}) } });
    } catch { return 'duplicate'; } // уникальный индекс (другое написание того же артикула)
    return 'set';
  }

  /**
   * В корзину: только пустая позиция (без остатка и брони) и не используемая в CRM.
   * Иначе 409 с объяснением, что сделать.
   */
  async removeItem(materialId: string) {
    const _id = oid(materialId, 'позиции');
    const item = await this.search.getItem(materialId);
    if (item.quantity > 0) throw new ConflictException(`На складе остаток ${item.quantity} ${item.unit ?? ''} — сначала спишите его или сделайте корректировку до 0`.replace(/\s+—/, ' —'));
    if (item.reservedQty > 0) throw new ConflictException(`По позиции есть бронь ${item.reservedQty} — сначала снимите бронь`);
    const db = this.materials.db;
    if ((await isUsedInComposition(db, 'material', _id)) || (await isUsedByCrm(db, 'material', _id))) {
      throw new ConflictException('Позиция используется в CRM (состав изделий, калькуляции или закупки) — удалить нельзя');
    }
    const now = new Date();
    await this.materials.updateOne({ _id, deletedAt: null }, { $set: { deletedAt: now } }).exec();
    await this.core.markEdited(_id);
    await this.storage.updateMany({ materialId: _id, deletedAt: null }, { $set: { deletedAt: now } }).exec();
    return { id: materialId, deleted: true };
  }

  async restoreItem(materialId: string) {
    const _id = oid(materialId, 'позиции');
    const mat = await this.materials.findOne({ _id, deletedAt: { $ne: null } }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!mat) throw new NotFoundException('Позиции нет в корзине');
    const twin = await this.findMaterialByName(mat.name);
    if (twin) throw new ConflictException(`Уже есть позиция «${twin.name}» — переименуйте её или удалите, потом восстановите эту`);
    const when = (mat as { deletedAt?: Date }).deletedAt;
    await this.materials.updateOne({ _id }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    // Строки остатка, удалённые вместе с позицией, возвращаются вместе с ней
    await this.storage.updateMany({ materialId: _id, deletedAt: when }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    return this.search.getItem(materialId);
  }

}
