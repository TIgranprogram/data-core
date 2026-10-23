import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { gramsToKg } from './weight';

/** ФИО сотрудника из persons (как в «Справочниках»). */
const personName = (p: { lastName?: unknown; firstName?: unknown; patronymic?: unknown }) =>
  [p.lastName, p.firstName, p.patronymic].map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join(' ');

/** Общие операции склада: склад по умолчанию, строка остатка, пометка «изменено в приложении», «кому выдано». */
@Injectable()
export class StockCoreService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
  ) {}

  /** Склад по умолчанию; если не назначен — первый действующий («Главный склад») становится им. */
  async defaultWarehouse(): Promise<WarehouseDocument> {
    const active = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };
    const def = await this.warehouses.findOne({ isDefault: true, ...active }).exec();
    if (def) return def;
    const first = await this.warehouses.findOne({ isActive: { $ne: false }, ...active }).sort({ createdAt: 1 }).exec();
    if (first) {
      await this.warehouses.updateOne({ _id: first._id }, { $set: { isDefault: true } }).exec();
      first.isDefault = true;
      return first;
    }
    return this.warehouses.create({ name: 'Главный склад', type: 'main', isActive: true, isDefault: true });
  }

  async listWarehouses() {
    const def = await this.defaultWarehouse();
    const items = await this.warehouses.find({ deletedAt: null }).sort({ name: 1 }).lean().exec();
    return { items, total: items.length, defaultId: String(def._id) };
  }

  /** Вес 1 шт. в граммах → weightKg (кг) + пометка weightUnit 'kg' у позиции и её остатков (НО.0). */
  async setWeightG(_id: Types.ObjectId, g: number | null | undefined) {
    const kg = g === null || g === undefined || !(Number(g) > 0) ? null : gramsToKg(Number(g));
    const set = kg === null ? { weightKg: null } : { weightKg: kg, weightUnit: 'kg' };
    await this.connection.db!.collection('materials').updateOne({ _id }, { $set: set });
    await this.connection.db!.collection('storageitems').updateMany({ materialId: _id }, { $set: set });
  }

  /** Кому выдано (TASKS Л.3): сотрудник из «Справочников» и/или текст («объект Парк», «бригада 2»). */
  async issueTarget(personId?: string, issuedTo?: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (personId) {
      const p = await this.connection.db!.collection('persons').findOne({ _id: oid(personId, 'сотрудника'), deletedAt: null }, { projection: { _id: 1 } });
      if (!p) throw new BadRequestException('Сотрудник не найден — обновите страницу');
      out.issuedToPersonId = p._id;
    }
    const t = issuedTo?.trim();
    if (t) out.issuedTo = t.slice(0, 200);
    return out;
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

}
