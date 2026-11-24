import type { ClientSession, Model, mongo, Types } from 'mongoose';
import { sameRe } from '../../common/text/same-text';
import type { MaterialDocument } from '../material/material.schema';

type Db = mongo.Db;
type MaterialModel = Model<MaterialDocument>;

/** Коллекции склада, где справочник меняет строку названия. Заявки — у supply-writes. */
const STOCK_LABEL = new Set(['materials', 'storageitems', 'stockmovements', 'reservations', 'warehouses']);

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const labelRe = (name: unknown) => new RegExp(`^\\s*${clean(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

/**
 * Объединение простого справочника: одно написание в строке склада.
 * Повтор после переноса находит 0. `editedInApp` не ставим: так было у движений и позиций.
 */
export function renameStockLabel(db: Db, coll: string, field: string, fromName: unknown, toName: unknown) {
  if (!STOCK_LABEL.has(coll)) throw new Error(`stock-writes: «${coll}» не коллекция склада`);
  return db.collection(coll).updateMany({ [field]: labelRe(fromName) }, { $set: { [field]: clean(toName) } });
}

/** Сортамент или марка стали. Повтор с тем же текстом ничего не меняет по смыслу. Дата — чтобы список увидел правку. */
export function renameMaterialSame(db: Db, field: string, fromName: unknown, toName: string) {
  return db.collection('materials').updateMany({ [field]: sameRe(fromName) }, { $set: { [field]: toName, updatedAt: new Date() } });
}

/** Цвет в массиве позиции. Совпадение точное, как раньше: не регулярка. */
export function renameMaterialColor(db: Db, fromName: string, toName: string) {
  return db.collection('materials').updateMany({ colors: fromName }, { $set: { 'colors.$': toName } });
}

/** Категория склада. Метку приложения не ставим: коллекция общая с CRM, как было. */
export function reassignMaterialCategory(db: Db, fromId: unknown, toId: unknown) {
  return db.collection('materials').updateMany({ categoryId: fromId }, { $set: { categoryId: toId } });
}

/** Единица измерения позиции. Повтор после переноса находит 0. */
export function reassignMaterialUnit(db: Db, values: readonly string[], symbol: string) {
  return db.collection('materials').updateMany({ unit: { $in: values } }, { $set: { unit: symbol } });
}

/** Связь позиции с материалом паспорта. Повтор пишет тот же id. */
export function reassignMaterialPassport(db: Db, fromId: unknown, toId: unknown) {
  return db.collection('materials').updateMany({ 'passportSpec.materialId': fromId }, { $set: { 'passportSpec.materialId': toId } });
}

/**
 * Перенос позиции заказа: бронь указывает на новый договор.
 * Сессия обязательна: вместе со строкой дохода, иначе ссылки разъедутся.
 * Повтор с тем же договором пишет то же поле.
 */
export function moveReservationsToOrder(db: Db, lineId: unknown, orderId: unknown, session: ClientSession) {
  return db.collection('reservations').updateMany({ salesOrderLineId: lineId }, { $set: { salesOrderId: orderId } }, { session });
}

/**
 * Поля карточки, которые API имеет право записать.
 * `stockQty` и остаток сюда не входят: их держат storageitems.
 * `deletedAt` — только снятие, не правка.
 */
const MATERIAL_CARD_FIELDS = [
  'name', 'article', 'sku', 'materialKind', 'assortment', 'standardRef', 'materialGrade', 'weightKg',
  'unit', 'categoryId', 'description', 'pricePerUnit', 'dimensions', 'colors', 'photoIds', 'mainPhotoId',
  'supplierId', 'notes', 'pdmCode', 'pdmAliases', 'pdm', 'dimSource', 'isProfile', 'profileId',
  'isDefaultFormat', 'scrapFactor', 'needsName', 'workTypes',
] as const;

/** Оставляет только известные поля карточки. Чужой ключ не попадает в `$set`. */
export function materialCardSet(input: object): Record<string, unknown> {
  const src = input as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const key of MATERIAL_CARD_FIELDS) {
    if (src[key] !== undefined) set[key] = src[key];
  }
  return set;
}

/**
 * Карточка материала. Правила (артикул, виды работ, версия) остаются в MaterialService.
 * Здесь только запись коллекции: импорт модуля material в stock замыкает пару.
 */
export function insertMaterial(model: MaterialModel, doc: object) {
  return model.create(doc);
}

/** Правка карточки. Чужой документ (deletedAt или склад организации) даёт null — 404 у вызывающего. */
export function patchMaterial(model: MaterialModel, filter: object, update: object) {
  return model.findOneAndUpdate(filter, update, { new: true, runValidators: true }).exec();
}

/** Состав детали. Версия `__v` растёт здесь: чужая версия не совпадёт с фильтром вызывающего. */
export function saveMaterialComposition(model: MaterialModel, filter: object, composition: unknown) {
  return model.findOneAndUpdate(filter, { $set: { composition }, $inc: { __v: 1 } }, { new: true, runValidators: true }).exec();
}

/** Связь с паспортом мимо схемы mongoose: так поле не теряется на общей коллекции. */
export function setMaterialPassportSpec(model: MaterialModel, id: unknown, update: object) {
  return model.collection.updateOne({ _id: id as Types.ObjectId }, update as never);
}

/** Корзина позиции. Повтор по уже снятой находит 0. */
export function archiveMaterial(model: MaterialModel, filter: object, deletedAt: Date) {
  return model.updateOne(filter, { $set: { deletedAt } }).exec();
}

/**
 * Последняя цена, если дата не старше уже записанной. Фильтр собирает цена.
 * Сессию передаёт счёт: цена и история одной транзакцией.
 */
export function touchMaterialLastPrice(model: MaterialModel, filter: object, update: object, session?: ClientSession) {
  return model.updateOne(filter, update, { session }).exec();
}

/** Сортамент или деталь из PDM, которую сняли. Повтор снимает deletedAt ещё раз — то же состояние. */
export function restorePdmMaterial(model: MaterialModel, id: unknown, session: ClientSession) {
  return model.updateOne({ _id: id }, { $set: { deletedAt: null } }, { session });
}

/** Новые позиции PDM пачкой. Порядок вставки сохраняется (`ordered`). */
export function insertPdmMaterials(model: MaterialModel, docs: object[], session: ClientSession) {
  return model.create(docs, { session, ordered: true });
}

/** Поля существующей позиции из PDM. Что писать, решает план импорта. */
export function patchPdmMaterial(model: MaterialModel, id: unknown, set: object, session: ClientSession) {
  return model.updateOne({ _id: id }, { $set: set }, { session });
}

/** Метиз: набор полей и другие написания. Пустой набор не шлёт пустой `$set`. */
export function patchPdmMaterialAliases(model: MaterialModel, id: unknown, set: object, aliases: readonly string[], session: ClientSession) {
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (aliases.length) update.$addToSet = { pdmAliases: { $each: [...aliases] } };
  return model.updateOne({ _id: id }, update, { session });
}

/** Фото детали из PDM. Главным становится, только если вызывающий уже решил, что старое главное тоже из PDM. */
export function attachMaterialPhoto(model: MaterialModel, id: unknown, photoId: unknown, main: boolean) {
  return model.updateOne({ _id: id }, { $addToSet: { photoIds: photoId }, ...(main ? { $set: { mainPhotoId: photoId } } : {}) }).exec();
}

/** Поля склада, которые API имеет право записать. `deletedAt` — только снятие, не правка. */
const WAREHOUSE_FIELDS = ['name', 'type', 'address', 'description', 'isActive', 'isDefault', 'zoneNames', 'roleIds'] as const;

type WarehouseQuery = { session: (session: ClientSession) => WarehouseQuery; exec: () => Promise<unknown> };
type WarehouseWriter = {
  updateOne: (filter: object, update: object) => WarehouseQuery;
  updateMany: (filter: object, update: object) => { exec: () => Promise<unknown> };
  create: (docs: object | object[], options?: { session?: ClientSession }) => Promise<unknown>;
};

/** Оставляет только известные поля. Чужой ключ не попадает в `$set` и не затирает документ. */
export function warehouseSet(input: object): Record<string, unknown> {
  const src = input as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const key of WAREHOUSE_FIELDS) {
    if (src[key] !== undefined) set[key] = src[key];
  }
  return set;
}

function assertWarehouseSet(set: Record<string, unknown>) {
  const allow = new Set<string>(WAREHOUSE_FIELDS);
  for (const key of Object.keys(set)) {
    if (!allow.has(key)) throw new Error(`stock-writes: поле «${key}» складу не пишем`);
  }
  if (!Object.keys(set).length) throw new Error('stock-writes: пустой $set склада');
}

/**
 * Новый склад. Сессия — как у склада по умолчанию: `create([doc], { session })`.
 * Без сессии — один документ. Это вставка, не замена живого документа.
 */
export function insertWarehouse(model: WarehouseWriter, value: object, session?: ClientSession) {
  const set = warehouseSet(value);
  if (!set.name) throw new Error('stock-writes: у склада нет названия');
  if (session) return model.create([set], { session }).then((rows) => (rows as unknown[])[0]);
  return model.create(set);
}

/** Правка склада: только `$set` известных полей. `replaceOne` и `save()` всего документа запрещены. */
export function patchWarehouse(model: WarehouseWriter, id: unknown, set: Record<string, unknown>) {
  assertWarehouseSet(set);
  return model.updateOne({ _id: id }, { $set: warehouseSet(set) });
}

/** Снять «по умолчанию» со всех складов перед назначением нового. */
export function clearWarehouseDefaults(model: WarehouseWriter) {
  return model.updateMany({ isDefault: true }, { $set: { isDefault: false } });
}

/** Снять «по умолчанию» с остальных, этот id не трогать. */
export function clearOtherWarehouseDefaults(model: WarehouseWriter, exceptId: unknown) {
  return model.updateMany({ _id: { $ne: exceptId }, isDefault: true }, { $set: { isDefault: false } });
}

/** Назначить один склад по умолчанию. Сессия вешается на query, как раньше в `defaultWarehouse`. */
export function markWarehouseDefault(model: WarehouseWriter, id: unknown, session?: ClientSession) {
  const update = model.updateOne({ _id: id }, { $set: { isDefault: true } });
  if (session) update.session(session);
  return update.exec();
}

/** Снятие с учёта. Повтор по уже снятому фильтру вызывающего не находит строку. */
export function archiveWarehouse(model: WarehouseWriter, id: unknown, deletedAt: Date) {
  return model.updateOne({ _id: id }, { $set: { deletedAt, isDefault: false } });
}
