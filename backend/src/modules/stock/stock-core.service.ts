import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { inScope, type StockScope } from '../../common/stock-scope';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { Warehouse, WarehouseDocument, type WarehouseType } from './schemas/warehouse.schema';
import { archiveWarehouse, clearOtherWarehouseDefaults, clearWarehouseDefaults, insertWarehouse, markWarehouseDefault, patchWarehouse, warehouseSet } from './stock-writes';
import { WAREHOUSE_API_FLAG } from './warehouse-flag';
import { gramsToKg } from './weight';

const WAREHOUSE_TYPES = new Set(['main', 'branch', 'transit', 'production', 'other']);
const liveWarehouse = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

export type WarehouseWrite = {
  name?: string;
  type?: WarehouseType;
  address?: string;
  description?: string;
  isActive?: boolean;
  isDefault?: boolean;
  zoneNames?: string[];
  roleIds?: string[];
};

/** ФИО сотрудника из persons (как в «Справочниках»). */
const personName = (p: { lastName?: unknown; firstName?: unknown; patronymic?: unknown }) =>
  [p.lastName, p.firstName, p.patronymic].map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join(' ');

/** Общие операции склада: склад по умолчанию, строка остатка, пометка «изменено в приложении», подписи «кому выдано». */
@Injectable()
export class StockCoreService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
    private readonly flags?: FeatureFlagService,
  ) {}

  /** Склад по умолчанию; если не назначен — первый действующий («Главный склад») становится им. Флаг C260 не смотрит. */
  async defaultWarehouse(session?: ClientSession): Promise<WarehouseDocument> {
    const active = liveWarehouse;
    const defaultQuery = this.warehouses.findOne({ isDefault: true, ...active });
    if (session) defaultQuery.session(session);
    const def = await defaultQuery.exec();
    if (def) return def;
    const firstQuery = this.warehouses.findOne({ isActive: { $ne: false }, ...active }).sort({ createdAt: 1 });
    if (session) firstQuery.session(session);
    const first = await firstQuery.exec();
    if (first) {
      await markWarehouseDefault(this.warehouses as never, first._id, session);
      first.isDefault = true;
      return first;
    }
    const value = { name: 'Главный склад', type: 'main' as const, isActive: true, isDefault: true };
    return insertWarehouse(this.warehouses as never, value, session) as Promise<WarehouseDocument>;
  }

  async listWarehouses() {
    const def = await this.defaultWarehouse();
    const items = await this.warehouses.find({ deletedAt: null }).sort({ name: 1 }).lean().exec();
    return { items, total: items.length, defaultId: String(def._id) };
  }

  /** Какие из позиций видны в доступе: id видимых; нет в базе — не видна; null — доступ полный (проверять не нужно). */
  async visibleMaterials(ids: Iterable<unknown>, scope: StockScope | null | undefined): Promise<Set<string> | null> {
    if (!scope) return null;
    const list = [...new Set([...ids].filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const mats = list.length ? await this.connection.db!.collection('materials').find({ _id: { $in: list } }, { projection: { categoryId: 1 } }).toArray() : [];
    return new Set(mats.filter((m) => inScope(scope, m)).map((m) => String(m._id)));
  }

  /** Все позиции должны быть в доступе, иначе 403 (запись по чужой позиции). Позиции, которых нет, пропускаются — их отвергнет сама операция. */
  async assertMaterials(ids: Iterable<unknown>, scope: StockScope | null | undefined, text = 'Эта позиция не из вашего склада'): Promise<void> {
    if (!scope) return;
    const list = [...new Set([...ids].filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const mats = list.length ? await this.connection.db!.collection('materials').find({ _id: { $in: list } }, { projection: { categoryId: 1 } }).toArray() : [];
    if (mats.some((m) => !inScope(scope, m))) throw new ForbiddenException(text);
  }

  /** Вес 1 шт. в граммах → weightKg (кг) + пометка weightUnit 'kg' у позиции и её остатков (НО.0). */
  async setWeightG(_id: Types.ObjectId, g: number | null | undefined) {
    const kg = g === null || g === undefined || !(Number(g) > 0) ? null : gramsToKg(Number(g));
    const set = kg === null ? { weightKg: null } : { weightKg: kg, weightUnit: 'kg' };
    await this.connection.db!.collection('materials').updateOne({ _id }, { $set: set });
    await this.connection.db!.collection('storageitems').updateMany({ materialId: _id }, { $set: set });
  }

  /** «Кому выдано» для списка движений: ФИО сотрудника и/или текст. id движения → подпись. */
  async issuedNames(docs: { _id: unknown; issuedToPersonId?: Types.ObjectId; issuedTo?: string }[]) {
    const ids = docs.map((d) => d.issuedToPersonId).filter(Boolean) as Types.ObjectId[];
    const persons = ids.length ? await this.connection.db!.collection('persons').find({ _id: { $in: ids } }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } }).toArray() : [];
    const pn = new Map(persons.map((p) => [String(p._id), personName(p as { lastName?: unknown })]));
    return new Map(docs.map((d) => [String(d._id), [d.issuedToPersonId ? pn.get(String(d.issuedToPersonId)) : null, d.issuedTo].filter(Boolean).join(' · ') || null]));
  }

  async loadStorage(warehouseId: Types.ObjectId, materialId: Types.ObjectId, session: ClientSession): Promise<StorageItemDocument> {
    const found = await this.storage.findOne({ warehouseId, materialId, deletedAt: null }).sort({ zoneName: 1 }).session(session).exec();
    if (found) return found;
    const [created] = await this.storage.create([{ warehouseId, materialId, quantity: 0, reservedQty: 0, isActive: true }], { session });
    return created;
  }

  /** Позиция изменена в приложении — синхронизация Google-таблицы её больше не перезаписывает (поле вне схемы CRM). */
  async markEdited(_id: Types.ObjectId): Promise<void> {
    await this.connection.db!.collection('materials').updateOne({ _id }, { $set: { editedInApp: true } });
  }

  /** C260: выкл — CRM снова может писать Mongo. Маршрут при этом остаётся и отвечает 409. */
  private async assertWarehouseApi() {
    const on = this.flags ? await this.flags.isEnabled(WAREHOUSE_API_FLAG) : false;
    if (!on) {
      throw new ConflictException('Флаг c260.warehouses.api выключен: склады снова пишет CRM в Mongo. Маршруты API не сняты.');
    }
  }

  private warehouseFields(dto: WarehouseWrite) {
    if (dto.type !== undefined && !WAREHOUSE_TYPES.has(dto.type)) throw new BadRequestException('Неизвестный тип склада');
    const name = dto.name === undefined ? undefined : String(dto.name).replace(/\s+/g, ' ').trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Укажите название склада');
    const roleIds = dto.roleIds?.map((id) => new Types.ObjectId(id));
    return warehouseSet({ ...dto, ...(name !== undefined ? { name } : {}), ...(roleIds ? { roleIds } : {}) });
  }

  private async liveById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Склад не найден');
    const doc = await this.warehouses.findOne({ _id: new Types.ObjectId(id), ...liveWarehouse }).lean().exec();
    if (!doc) throw new NotFoundException('Склад не найден');
    return doc;
  }

  /** Создать склад. Один `isDefault`: нет текущего — новый становится им. */
  async createWarehouse(dto: WarehouseWrite) {
    await this.assertWarehouseApi();
    const name = String(dto.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new BadRequestException('Укажите название склада');
    const set = this.warehouseFields({ ...dto, name, type: dto.type ?? 'main', isActive: dto.isActive ?? true });
    const current = await this.warehouses.findOne({ isDefault: true, ...liveWarehouse }).select('_id').lean().exec();
    set.isDefault = dto.isDefault === true || !current;
    if (set.isDefault) await clearWarehouseDefaults(this.warehouses as never).exec();
    return insertWarehouse(this.warehouses as never, set);
  }

  /** Правка известных полей. Снять единственный «по умолчанию» нельзя. */
  async patchWarehouse(id: string, dto: WarehouseWrite) {
    await this.assertWarehouseApi();
    const doc = await this.liveById(id);
    const set = this.warehouseFields(dto);
    if (!Object.keys(set).length) throw new BadRequestException('Нет полей для записи');
    if (set.isDefault === false && doc.isDefault) throw new ConflictException('Один склад должен остаться по умолчанию');
    if (set.isDefault === true) await clearOtherWarehouseDefaults(this.warehouses as never, doc._id).exec();
    await patchWarehouse(this.warehouses as never, doc._id, set).exec();
    return this.warehouses.findOne({ _id: doc._id }).lean().exec();
  }

  /** Снятие с учёта (`deletedAt`). Был по умолчанию — назначается другой действующий, без создания нового. */
  async removeWarehouse(id: string) {
    await this.assertWarehouseApi();
    const doc = await this.liveById(id);
    const next = doc.isDefault
      ? await this.warehouses.findOne({ _id: { $ne: doc._id }, isActive: { $ne: false }, ...liveWarehouse }).sort({ createdAt: 1 }).lean().exec()
      : null;
    await archiveWarehouse(this.warehouses as never, doc._id, new Date()).exec();
    if (next?._id) await markWarehouseDefault(this.warehouses as never, next._id);
    return this.warehouses.findOne({ _id: doc._id }).lean().exec();
  }

}
