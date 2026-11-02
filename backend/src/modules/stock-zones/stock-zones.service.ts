import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe } from '../../common/list-query';
import { setCategoryTree, setStockZones, zonesFor, type ZoneDef } from '../../common/stock-scope';
import { StockZone, StockZoneDocument } from './stock-zone.schema';
import type { CreateStockZoneDto, UpdateStockZoneDto } from './dto/stock-zone.dto';

type Lean = { _id: Types.ObjectId; name: string; categoryIds?: Types.ObjectId[]; includeMaterialIds?: Types.ObjectId[]; excludeMaterialIds?: Types.ObjectId[]; isDefault?: boolean; order?: number };

const strs = (a?: Types.ObjectId[]) => (a ?? []).map(String);
const present = (z: Lean) => ({ id: String(z._id), name: z.name, categoryIds: strs(z.categoryIds), includeMaterialIds: strs(z.includeMaterialIds), excludeMaterialIds: strs(z.excludeMaterialIds), isDefault: z.isDefault === true, order: z.order ?? 100 });
const asDef = (z: Lean): ZoneDef => ({ id: String(z._id), name: z.name, categoryIds: strs(z.categoryIds), includeIds: strs(z.includeMaterialIds), excludeIds: strs(z.excludeMaterialIds), isDefault: z.isDefault === true });
const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, limit: items.length || 1 });

/** Дерево категорий читается раз в минуту: подкатегория, добавленная позже, входит в склад без перезапуска. */
const TREE_REFRESH_MS = 60_000;

/** Справочник «Склады» (stockzones) + кэш доступа в памяти (common/stock-scope.ts). Обновляется при правке склада и по таймеру. */
@Injectable()
export class StockZonesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StockZonesService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(StockZone.name) private readonly model: Model<StockZoneDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => { this.refresh().catch((e) => this.log.warn(`Кэш складов не обновлён: ${e instanceof Error ? e.message : e}`)); }, TREE_REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async live(): Promise<Lean[]> {
    return (await this.model.find({ deletedAt: null }).sort({ order: 1, name: 1 }).lean().exec()) as unknown as Lean[];
  }

  /** Перечитать склады и дерево категорий в кэш доступа. */
  async refresh(): Promise<void> {
    const [zones, cats] = await Promise.all([
      this.live(),
      this.connection.db!.collection('categories').find({ type: 'material' }, { projection: { parentId: 1 } }).toArray(),
    ]);
    setCategoryTree(cats.map((c) => ({ id: String(c._id), parentId: c.parentId ? String(c.parentId) : null })));
    setStockZones(zones.map(asDef));
  }

  async list() { return page((await this.live()).map(present)); }

  /** Склады, доступные пользователю (переключатель склада); admin и владелец — все. */
  async forUser(user: { role?: string | null; isOwner?: boolean } | undefined) {
    const mine = zonesFor(user);
    const ids = mine ? new Set(mine.map((z) => z.id)) : null;
    return page((await this.live()).filter((z) => !ids || ids.has(String(z._id))).map((z) => ({ id: String(z._id), name: z.name, isDefault: z.isDefault === true, order: z.order ?? 100, categoryIds: strs(z.categoryIds) }))); // categoryIds — плитки складов «Остатков»
  }

  async get(id: string) { return present(await this.find(id)); }

  private async find(id: string): Promise<Lean> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id склада');
    const z = await this.model.findOne({ _id: id, deletedAt: null }).lean().exec();
    if (!z) throw new NotFoundException('Склад не найден');
    return z as unknown as Lean;
  }

  private async checkRefs(dto: { categoryIds?: string[]; includeMaterialIds?: string[]; excludeMaterialIds?: string[] }): Promise<void> {
    const db = this.connection.db!;
    if (dto.categoryIds?.length) {
      const n = await db.collection('categories').countDocuments({ _id: { $in: this.oids(dto.categoryIds) }, type: 'material' });
      if (n !== dto.categoryIds.length) throw new BadRequestException('Какой-то категории нет среди категорий материалов');
    }
    const mats = [...new Set([...(dto.includeMaterialIds ?? []), ...(dto.excludeMaterialIds ?? [])])];
    if (mats.length && (await db.collection('materials').countDocuments({ _id: { $in: this.oids(mats) } })) !== mats.length) throw new BadRequestException('Какой-то позиции склада нет');
    if ((dto.includeMaterialIds ?? []).some((x) => dto.excludeMaterialIds?.includes(x))) throw new BadRequestException('Одна позиция и в добавках, и в исключениях');
  }

  private async uniqueName(name: string, exceptId?: string): Promise<void> {
    const same = await this.model.findOne({ deletedAt: null, name: new RegExp(`^${escapeRe(name.trim())}$`, 'i'), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean().exec();
    if (same) throw new ConflictException('Склад с таким названием уже есть');
  }

  private oids(a?: string[]): Types.ObjectId[] { return (a ?? []).map((x) => new Types.ObjectId(x)); }

  /** «Основной» один: новый isDefault снимает метку с прежнего. */
  private async takeDefault(exceptId?: string): Promise<void> {
    await this.model.updateMany({ isDefault: true, deletedAt: null, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { $set: { isDefault: false } });
  }

  async create(dto: CreateStockZoneDto) {
    await this.uniqueName(dto.name);
    await this.checkRefs(dto);
    if (dto.isDefault) await this.takeDefault();
    const doc = await this.model.create({ name: dto.name.trim(), categoryIds: this.oids(dto.categoryIds), includeMaterialIds: this.oids(dto.includeMaterialIds), excludeMaterialIds: this.oids(dto.excludeMaterialIds), isDefault: dto.isDefault === true, order: dto.order ?? 100 });
    await this.refresh();
    return this.get(String(doc._id));
  }

  async update(id: string, dto: UpdateStockZoneDto) {
    const cur = await this.find(id);
    if (dto.name !== undefined) await this.uniqueName(dto.name, id);
    await this.checkRefs({ ...dto, includeMaterialIds: dto.includeMaterialIds ?? strs(cur.includeMaterialIds), excludeMaterialIds: dto.excludeMaterialIds ?? strs(cur.excludeMaterialIds) });
    if (dto.isDefault === false && cur.isDefault) throw new BadRequestException('«Основной» склад должен остаться: назначьте основным другой');
    if (dto.isDefault) await this.takeDefault(id);
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.categoryIds) set.categoryIds = this.oids(dto.categoryIds);
    if (dto.includeMaterialIds) set.includeMaterialIds = this.oids(dto.includeMaterialIds);
    if (dto.excludeMaterialIds) set.excludeMaterialIds = this.oids(dto.excludeMaterialIds);
    if (dto.isDefault !== undefined) set.isDefault = dto.isDefault;
    if (dto.order !== undefined) set.order = dto.order;
    if (Object.keys(set).length) await this.model.updateOne({ _id: id }, { $set: set });
    await this.refresh();
    return this.get(id);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const z = await this.find(id);
    if (z.isDefault) throw new ConflictException('«Основной» склад удалить нельзя: сначала назначьте основным другой');
    const used = await this.connection.db!.collection('roles').countDocuments({ warehouseIds: String(z._id) });
    if (used > 0) throw new ConflictException(`Склад выбран в ролях (${used}) — сначала уберите его из ролей`);
    await this.model.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
    await this.refresh();
    return { ok: true };
  }
}
