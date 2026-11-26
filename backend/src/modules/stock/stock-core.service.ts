import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { inScope, type StockScope } from '../../common/stock-scope';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { Warehouse, WarehouseDocument, type WarehouseType } from './schemas/warehouse.schema';
import { archiveWarehouse, clearWarehouseDefaults, insertWarehouse, patchWarehouse, warehouseSet } from './stock-writes';
import { WAREHOUSE_API_FLAG } from './warehouse-flag';
import { gramsToKg } from './weight';

const WAREHOUSE_TYPES = new Set(['main', 'branch', 'transit', 'production', 'other']);
const liveWarehouse = { deletedAt: null };
const activeWarehouse = { ...liveWarehouse, isActive: { $ne: false } };
const oldestWarehouse = { createdAt: 1, _id: 1 } as const;
const warehouseGuardCollection = 'stock_warehouse_guards';
const defaultWarehouseGuard = 'default';
const warehouseWriteConcern = { w: 'majority' } as const;
type WarehouseGuard = { _id: string; revision: number };

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
export class StockCoreService implements OnModuleInit {
  private readonly logger = new Logger(StockCoreService.name);
  private warehouseGuardReady?: Promise<void>;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
    private readonly flags?: FeatureFlagService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureWarehouseGuard();
    } catch (error) {
      this.logger.warn(`Не удалось подготовить блокировку склада: ${(error as Error).message}`);
    }
  }

  private ensureWarehouseGuard(): Promise<void> {
    this.warehouseGuardReady ??= this.prepareWarehouseGuard().catch(error => {
      this.warehouseGuardReady = undefined;
      throw error;
    });
    return this.warehouseGuardReady;
  }

  private async prepareWarehouseGuard(): Promise<void> {
    // Mongo 4.4: обе коллекции и singleton должны существовать до транзакции с readConcern snapshot.
    await this.warehouses.createCollection({ writeConcern: warehouseWriteConcern });
    const db = this.connection.db!;
    try {
      await db.createCollection(warehouseGuardCollection, { writeConcern: warehouseWriteConcern });
    } catch (error) {
      if ((error as { code?: number }).code !== 48) throw error;
    }
    try {
      await db.collection<WarehouseGuard>(warehouseGuardCollection).insertOne({ _id: defaultWarehouseGuard, revision: 0 }, { writeConcern: warehouseWriteConcern });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  private async withWarehouseGuard<T>(work: (session: ClientSession) => Promise<T>, external?: ClientSession): Promise<T> {
    const run = async (session: ClientSession) => {
      // Общая запись сериализует транзакции даже тогда, когда оба запроса видят пустой набор складов.
      const result = await this.connection.db!.collection<WarehouseGuard>(warehouseGuardCollection)
        .updateOne({ _id: defaultWarehouseGuard }, { $inc: { revision: 1 } }, { session });
      if (!result.matchedCount) throw new ServiceUnavailableException('Блокировка склада ещё недоступна');
      return work(session);
    };
    if (external?.inTransaction()) return run(external);
    await this.ensureWarehouseGuard();
    const session = external ?? await this.connection.startSession();
    try {
      return await session.withTransaction(() => run(session), { readConcern: { level: 'snapshot' }, writeConcern: warehouseWriteConcern });
    } finally {
      if (!external) await session.endSession();
    }
  }

  private findActiveDefault(session: ClientSession) {
    return this.warehouses.findOne({ ...activeWarehouse, isDefault: true }).sort(oldestWarehouse).session(session).exec();
  }

  private async reconcileWarehouseDefault(session: ClientSession): Promise<WarehouseDocument | null> {
    const selected = await this.findActiveDefault(session)
      ?? await this.warehouses.findOne(activeWarehouse).sort(oldestWarehouse).session(session).exec();
    await clearWarehouseDefaults(this.warehouses as never, session, selected?._id);
    if (selected && !selected.isDefault) {
      await patchWarehouse(this.warehouses as never, selected._id, { isDefault: true }, session);
      selected.isDefault = true;
    }
    return selected;
  }

  /** Быстрое чтение одного действующего default. Создание и восстановление идут через того же владельца, что и ручная запись. */
  async defaultWarehouse(session?: ClientSession): Promise<WarehouseDocument> {
    const query = this.warehouses.find({ ...liveWarehouse, isDefault: true }).limit(2);
    if (session) query.session(session);
    const defaults = await query.exec();
    if (defaults.length === 1 && defaults[0].isActive !== false) return defaults[0];
    return this.withWarehouseGuard(async transaction => {
      const selected = await this.reconcileWarehouseDefault(transaction);
      if (selected) return selected;
      const value = { name: 'Главный склад', type: 'main', isActive: true, isDefault: true };
      return insertWarehouse(this.warehouses as never, value, transaction) as Promise<WarehouseDocument>;
    }, session);
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

  private async liveById(id: string, session: ClientSession) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Склад не найден');
    const doc = await this.warehouses.findOne({ _id: new Types.ObjectId(id), ...liveWarehouse }).session(session).lean().exec();
    if (!doc) throw new NotFoundException('Склад не найден');
    return doc;
  }

  /** Создать склад. Один `isDefault`: нет текущего — новый становится им. */
  async createWarehouse(dto: WarehouseWrite) {
    await this.assertWarehouseApi();
    const name = String(dto.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new BadRequestException('Укажите название склада');
    const set = this.warehouseFields({ ...dto, name, type: dto.type ?? 'main', isActive: dto.isActive ?? true });
    if (set.isActive === false && set.isDefault === true) throw new ConflictException('Неактивный склад нельзя назначить по умолчанию');
    return this.withWarehouseGuard(async session => {
      const isDefault = set.isActive !== false && (set.isDefault === true || !(await this.findActiveDefault(session)));
      if (isDefault) await clearWarehouseDefaults(this.warehouses as never, session);
      const created = await insertWarehouse(this.warehouses as never, { ...set, isDefault }, session);
      if (!isDefault) await this.reconcileWarehouseDefault(session);
      return created;
    });
  }

  /** Правка известных полей. Снять единственный «по умолчанию» нельзя. */
  async patchWarehouse(id: string, dto: WarehouseWrite) {
    await this.assertWarehouseApi();
    const set = this.warehouseFields(dto);
    if (!Object.keys(set).length) throw new BadRequestException('Нет полей для записи');
    return this.withWarehouseGuard(async session => {
      const doc = await this.liveById(id, session);
      const active = (set.isActive === undefined ? doc.isActive : set.isActive) !== false;
      if (set.isDefault === true && !active) throw new ConflictException('Неактивный склад нельзя назначить по умолчанию');
      if (set.isDefault === false && active && doc.isActive !== false && doc.isDefault) {
        throw new ConflictException('Один склад должен остаться по умолчанию');
      }
      if (set.isDefault === true) await clearWarehouseDefaults(this.warehouses as never, session, doc._id);
      await patchWarehouse(this.warehouses as never, doc._id, set, session);
      if (set.isDefault !== true) await this.reconcileWarehouseDefault(session);
      return this.warehouses.findOne({ _id: doc._id }).session(session).lean().exec();
    });
  }

  /** Снятие с учёта (`deletedAt`). Был по умолчанию — назначается другой действующий, без создания нового. */
  async removeWarehouse(id: string) {
    await this.assertWarehouseApi();
    return this.withWarehouseGuard(async session => {
      const doc = await this.liveById(id, session);
      await archiveWarehouse(this.warehouses as never, doc._id, new Date(), session);
      await this.reconcileWarehouseDefault(session);
      return this.warehouses.findOne({ _id: doc._id }).session(session).lean().exec();
    });
  }

}
