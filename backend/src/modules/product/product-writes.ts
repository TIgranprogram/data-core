import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ClientSession, mongo } from 'mongoose';
import { Types } from 'mongoose';
import { moveOrderedRef } from '../../common/catalog/ordered-refs';

type Db = mongo.Db;
type Doc = Record<string, unknown>;
type Update = Doc | Doc[] | mongo.Document[];
/** Сырые фильтры и конвейеры шире схемы mongoose: коллекция приведена к этому виду. */
type ProductsColl = {
  updateOne(filter: Doc, update: Update, options?: object): Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany(filter: Doc, update: Update, options?: object): Promise<{ matchedCount: number; modifiedCount: number }>;
  insertOne(doc: Doc, options?: object): Promise<{ insertedId: Types.ObjectId }>;
  findOne(filter: Doc, options?: object): Promise<Doc | null>;
};

/** Модель изделия у PDM: хуки timestamps/аудита остаются, вызов тот же, что был у сервиса. */
type PdmProductModel = {
  updateOne(filter: Doc, update: Doc, options?: { session?: ClientSession }): unknown;
  create(docs: Doc[], options?: { session?: ClientSession; ordered?: boolean }): unknown;
};

const STALE_BULK = 'Изделие изменено другим пользователем — обновите список и повторите';
const STALE_UNDO = 'Изделие изменено другим пользователем — обновите список';
const STALE_PLAN = 'Изделие изменили после копии — обновите план';
const STALE_PASSPORT = 'Изделие изменилось во время подготовки паспорта — повторите создание';
const STALE_IMPORT = 'Изделие изменено или удалено';
const STALE_PROMOTE = 'Источник изменился или неоднозначен. Откройте редактор заново и проверьте источник.';
const MISSING = 'Изделие не найдено';
const TEMPLATE_CONFLICT = 'Настройки изменились — перечитайте книжку';

function products(db: Db): ProductsColl {
  return db.collection('products') as unknown as ProductsColl;
}

function collapsed(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Значения паспорта целиком. Нет живого изделия — 404, вторая запись не начинается. */
export async function replacePassportDefaults(db: Db, id: Types.ObjectId, defaults: unknown) {
  const result = await products(db).updateOne({ _id: id, deletedAt: null }, [
    { $set: { passportDefaults: defaults, updatedAt: new Date() } },
  ]);
  if (!result.matchedCount) throw new NotFoundException(MISSING);
  return result;
}

/**
 * Одна строка массовой правки. Чужой ожидаемый снимок — конфликт, строка не меняется.
 * Обрыв одной строки не пишет остальные: вызывающий ловит ошибку и идёт дальше.
 */
export async function commitBulkProductRow(db: Db, id: unknown, expected: Doc, commit: Update, session: ClientSession) {
  const result = await products(db).updateOne({ _id: id, deletedAt: null, ...expected }, commit, { session });
  if (!result.matchedCount) throw new ConflictException(STALE_BULK);
  return result;
}

/** Черновик витрины. Дубль артикула проверяет вызывающий до вставки. */
export function insertShowcaseProduct(db: Db, doc: Doc, session?: ClientSession) {
  return products(db).insertOne(doc, { session });
}

/** Элементы признаков в умолчания только что созданного черновика. Повтор пишет тот же список. */
export function setShowcaseFacetElements(db: Db, id: unknown, elements: unknown, session?: ClientSession) {
  return products(db).updateOne({ _id: id }, { $set: { 'passportDefaults.elements': elements } }, { session });
}

/** Артикул группы. Повтор с тем же артикулом ничего не меняет по смыслу. */
export function assignShowcaseSku(db: Db, id: Types.ObjectId, sku: string) {
  return products(db).updateOne({ _id: id }, { $set: { sku, updatedAt: new Date() } });
}

/** Клон или вариант: документ уже собран вызывающим, здесь только вставка. */
export function insertProductCopy(db: Db, doc: Doc) {
  return products(db).insertOne(doc);
}

/** Правка карточки витрины. Нет живого изделия — 404. */
export async function patchShowcaseProduct(db: Db, id: Types.ObjectId, patch: Update) {
  const result = await products(db).updateOne({ _id: id, deletedAt: null }, patch);
  if (!result.matchedCount) throw new NotFoundException(MISSING);
  return result;
}

/** В корзину. Уже удалённое не трогаем второй раз — 404. */
export async function archiveShowcaseProduct(db: Db, id: Types.ObjectId, at = new Date()) {
  const result = await products(db).updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: at } });
  if (!result.matchedCount) throw new NotFoundException(MISSING);
  return result;
}

/** Вернуть из корзины. Совпадений может не быть — как раньше, ошибку не кидаем. */
export function restoreShowcaseProduct(db: Db, id: Types.ObjectId) {
  return products(db).updateOne({ _id: id }, { $set: { deletedAt: null } });
}

/** Отмена массовой правки. Снимок разошёлся — конфликт, прежние поля не пишем. */
export async function restoreBulkProduct(db: Db, id: Types.ObjectId, expected: Doc, patch: Update) {
  const result = await products(db).updateOne({ _id: id, deletedAt: null, ...expected }, patch);
  if (!result.matchedCount) throw new ConflictException(STALE_UNDO);
  return result;
}

/** Состав целиком. Повтор с тем же массивом переписывает его тем же значением. */
export function replaceProductComposition(db: Db, id: Types.ObjectId, composition: unknown[]) {
  return products(db).updateOne({ _id: id }, { $set: { composition, updatedAt: new Date() } });
}

/** Умолчания паспорта у изделия, только что созданного из паспорта. Пустой набор вызывающий не шлёт. */
export function setDefaultsFromPassport(db: Db, id: Types.ObjectId, defaults: Doc) {
  return products(db).updateOne({ _id: id }, { $set: { passportDefaults: defaults, source: 'passports' } });
}

/**
 * Книжка паспорта: сравнение полей в том же update. Нет изделия — 404.
 * Изделие есть, но снимок чужой — конфликт, поля не меняются.
 */
export async function commitPassportTemplate(db: Db, filter: Doc, compare: unknown[], set: Doc) {
  const coll = products(db);
  const result = await coll.updateOne({ ...filter, $expr: { $and: compare } }, [{ $set: set }]);
  if (!result.matchedCount) {
    if (!(await coll.findOne(filter, { projection: { _id: 1 } }))) throw new NotFoundException(MISSING);
    throw new ConflictException(TEMPLATE_CONFLICT);
  }
  return result;
}

/** Часть изделия: все строки с этой частью переходят на другую. Повтор находит 0. */
export async function reassignProductPart(db: Db, fromId: unknown, toId: unknown) {
  const result = await products(db).updateMany(
    { 'parts.partId': fromId },
    { $set: { 'parts.$[p].partId': toId } },
    { arrayFilters: [{ 'p.partId': fromId }] },
  );
  return result.modifiedCount;
}

/** Серия хранится строкой. Лишние пробелы схлопываются, повтор после переноса находит 0. */
export async function reassignProductSeries(db: Db, fromName: unknown, toName: unknown) {
  const from = collapsed(fromName);
  const name = collapsed(toName);
  const re = new RegExp(`^\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const result = await products(db).updateMany({ series: re }, { $set: { series: name, updatedAt: new Date() } });
  return result.modifiedCount;
}

/** Размер материала в таблице изделия. Разные материалы вызывающий не объединяет. */
export async function reassignProductMaterialSize(db: Db, materialIds: unknown[], fromName: string, toName: string) {
  const result = await products(db).updateMany(
    { 'materialsSpec.rows': { $elemMatch: { materialId: { $in: materialIds }, sizes: fromName } } },
    { $set: { 'materialsSpec.rows.$[r].sizes.$[z]': toName } },
    { arrayFilters: [{ 'r.materialId': { $in: materialIds } }, { z: fromName }] },
  );
  return result.modifiedCount;
}

/**
 * Материал паспорта в таблице изделия: строка, затем покрытие (сначала добавить, потом снять).
 * Складской материал вызывающий пишет сам — это не коллекция изделий.
 */
export async function reassignProductMaterialSpec(db: Db, fromId: unknown, toId: unknown) {
  const coll = products(db);
  let n = (await coll.updateMany(
    { 'materialsSpec.rows.materialId': fromId },
    { $set: { 'materialsSpec.rows.$[r].materialId': toId } },
    { arrayFilters: [{ 'r.materialId': fromId }] },
  )).modifiedCount;
  await coll.updateMany(
    { $and: [{ 'materialsSpec.coatingIds': fromId }, { 'materialsSpec.coatingIds': { $ne: toId } }] },
    { $push: { 'materialsSpec.coatingIds': toId } },
  );
  n += (await coll.updateMany({ 'materialsSpec.coatingIds': fromId }, { $pull: { 'materialsSpec.coatingIds': fromId } })).modifiedCount;
  return n;
}

/** Часть текста паспорта: таблица материалов и краткий список. Уже стоящее значение не дублируется. */
export async function reassignProductPassportPart(db: Db, fromId: mongo.ObjectId, toId: mongo.ObjectId) {
  const coll = products(db);
  const partPath = 'passportDefaults.simpleDescription.partIds';
  const rich = await coll.updateMany(
    { 'materialsSpec.rows.partIds': fromId },
    { $set: { 'materialsSpec.rows.$[].partIds.$[p]': toId } },
    { arrayFilters: [{ p: fromId }] },
  );
  const brief = await coll.updateMany({ [partPath]: fromId }, moveOrderedRef(partPath, fromId, toId));
  return rich.modifiedCount + brief.modifiedCount;
}

/** Вид паспорта на изделии хранится строкой id. Повтор после переноса находит 0. */
export async function reassignProductPassportKind(db: Db, fromId: unknown, toId: unknown) {
  const result = await products(db).updateMany(
    { 'passportDefaults.kindId': String(fromId) },
    { $set: { 'passportDefaults.kindId': String(toId), updatedAt: new Date() } },
  );
  return result.modifiedCount;
}

/** Выбор фразы паспорта у изделий. Выданные паспорта эта операция не трогает. */
export function reassignProductPassportPhrase(db: Db, root: string, fromId: string, toId: string) {
  return products(db).updateMany(
    { [`passportDefaults.textChoices.${root}`]: fromId },
    { $set: { [`passportDefaults.textChoices.${root}`]: toId, updatedAt: new Date() } },
  );
}

/** Группа изделия. updatedAt не ставим: раньше поле категории менялось без метки. */
export async function reassignProductCategory(db: Db, fromId: unknown, toId: unknown) {
  const result = await products(db).updateMany({ categoryId: fromId }, { $set: { categoryId: toId } });
  return result.modifiedCount;
}

/** Признак изделия: сначала новое значение, потом старое. Обратный порядок стёр бы связь. */
export async function reassignProductFacet(db: Db, fromId: unknown, toId: unknown) {
  const filter = { facetValueIds: fromId };
  const coll = products(db);
  const added = await coll.updateMany(filter, { $addToSet: { facetValueIds: toId } });
  await coll.updateMany(filter, { $pull: { facetValueIds: fromId } });
  return added.modifiedCount;
}

/** Пустое название в договоре. Уже заполненное и пустой текст не пишем. */
export async function fillEmptyOrderName(db: Db, productId: string, title: string) {
  const name = title.trim();
  if (!name) return;
  await products(db).updateOne(
    { _id: new Types.ObjectId(productId), $or: [{ orderName: { $exists: false } }, { orderName: null }, { orderName: '' }] },
    { $set: { orderName: name } },
  );
}

/** Пустой проектировщик. Уже назначенного не перебиваем. */
export function fillProductDesigner(db: Db, productId: Types.ObjectId, assigneeId: unknown) {
  return products(db).updateOne(
    { _id: productId, designerId: null },
    { $set: { designerId: assigneeId, updatedAt: new Date() } },
  );
}

/** План в изделие. Чужой updatedAt — конфликт, части и маршрут не пишем. */
export async function applyPlanToProduct(db: Db, id: unknown, current: unknown, set: Doc, unset: Doc, stamp: Date, session: ClientSession) {
  const result = await products(db).updateOne(
    { _id: id, updatedAt: current },
    { $set: { ...set, updatedAt: stamp }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { session },
  );
  if (!result.matchedCount) throw new ConflictException(STALE_PLAN);
  return result;
}

/** Норма факта в маршрут. Нет шагов с фактом — вызывающий не зовёт. Повтор пишет те же часы. */
export function applyProductWorkNorm(db: Db, id: unknown, types: unknown) {
  return products(db).updateOne({ _id: id }, { $set: { workTypes: types, updatedAt: new Date() } });
}

/** Маршрут и части целиком. Пустой список шагов снимает маршрут через $unset вызывающего. */
export function saveProductRoute(db: Db, id: Types.ObjectId, set: Doc, unset: Doc) {
  return products(db).updateOne(
    { _id: id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  );
}

/** Состав изделия из задания на модуль. Версия растёт вместе с записью. Модуль — не эта коллекция. */
export function saveReleasedProductComposition(db: Db, id: Types.ObjectId, lines: unknown, session: ClientSession) {
  return products(db).updateOne(
    { _id: id },
    { $set: { composition: lines, updatedAt: new Date() }, $inc: { __v: 1 } },
    { session },
  );
}

async function touchLiveProduct(db: Db, id: Types.ObjectId, session: ClientSession) {
  return products(db).updateOne({ _id: id, deletedAt: null }, { $inc: { __v: 1 }, $set: { updatedAt: new Date() } }, { session });
}

/** Захват изделия перед паспортом. Чужая версия или удаление — конфликт, паспорт не вставляется. */
export async function claimPassportProductVersion(db: Db, id: Types.ObjectId, session: ClientSession) {
  const result = await touchLiveProduct(db, id, session);
  if (!result.matchedCount) throw new ConflictException(STALE_PASSPORT);
  return result;
}

/** Захват перед фото паспорта. Нет живого изделия — 404, фото не пишется. */
export async function claimProductPhotoVersion(db: Db, id: Types.ObjectId, session: ClientSession) {
  const result = await touchLiveProduct(db, id, session);
  if (!result.matchedCount) throw new NotFoundException(MISSING);
  return result;
}

/** Поля изделия из импорта Inventor. Нет живого — конфликт, рисунки паспорта следом не пишутся. */
export async function importPassportProductFields(db: Db, productId: unknown, productSet: Doc, session: ClientSession) {
  const result = await products(db).updateOne(
    { _id: productId, deletedAt: null },
    { $set: { ...productSet, updatedAt: new Date() }, $inc: { __v: 1 } },
    { session },
  );
  if (!result.matchedCount) throw new ConflictException(STALE_IMPORT);
  return result;
}

/** Текст паспорта на изделии (своё поле или воронка). Чужой снимок — конфликт, 0 или 2 совпадения тоже. */
export async function promoteProductPassportField(db: Db, filter: Doc, update: Doc) {
  const result = await products(db).updateOne(filter, update);
  if (result.matchedCount !== 1) throw new ConflictException(STALE_PROMOTE);
  return result;
}

/** Группа из папки PDM — только если своей ещё нет. */
export function fillEmptyProductCategory(model: PdmProductModel, id: unknown, categoryId: unknown, session: ClientSession) {
  return model.updateOne(
    { _id: id, $or: [{ categoryId: null }, { categoryId: { $exists: false } }] },
    { $set: { categoryId } },
    { session },
  );
}

/** Вес из PDM — только в пустое или нулевое поле. Ноль и меньше не пишем. */
export function fillEmptyProductWeight(model: PdmProductModel, id: unknown, massKg: number, session: ClientSession) {
  const kg = Number(massKg);
  if (!(kg > 0)) return undefined;
  return model.updateOne(
    { _id: id, $or: [{ weightKg: null }, { weightKg: { $exists: false } }, { weightKg: 0 }] },
    { $set: { weightKg: Math.round(kg * 10) / 10 } },
    { session },
  );
}

/** Правка существующего изделия из дерева PDM. Состав и поля уже собраны вызывающим. */
export function updatePdmProduct(model: PdmProductModel, id: unknown, set: Doc, session: ClientSession) {
  return model.updateOne({ _id: id }, { $set: set }, { session });
}

/** Новые изделия PDM одной пачкой, порядок вставки сохраняется. */
export function insertPdmProducts(model: PdmProductModel, docs: Doc[], session: ClientSession) {
  return model.create(docs, { session, ordered: true });
}

/** Фото PDM на изделие. Главным становится, только если вызывающий уже разрешил. */
export function attachPdmProductPhoto(model: PdmProductModel, id: unknown, photoId: unknown, makeMain: boolean) {
  return model.updateOne(
    { _id: id },
    { $addToSet: { photoIds: photoId }, ...(makeMain ? { $set: { mainPhotoId: photoId } } : {}) },
  );
}
