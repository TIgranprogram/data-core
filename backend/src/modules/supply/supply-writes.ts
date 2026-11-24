import type { ClientSession, mongo, Types } from 'mongoose';
import { sameRe } from '../../common/text/same-text';

type Db = mongo.Db;

/** Карточка заявки (create/patch/delete) — `SupplyService` и флаг C262. Здесь чужие сценарии: справочник и перенос. Флаг их не смотрит. */

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const labelRe = (name: unknown) => new RegExp(`^\\s*${clean(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

/**
 * Объединение справочника в заявке. `editedInApp` — чтобы синхронизация CRM не затёрла строку.
 * Повтор после переноса находит 0. Сессию справочник не открывает.
 */
export function renameSupplyLabel(db: Db, field: string, fromName: unknown, toName: unknown) {
  return db.collection('supplyrequests').updateMany(
    { [field]: labelRe(fromName) },
    { $set: { [field]: clean(toName), editedInApp: true } },
  );
}

/** Категория заявки вместе с позицией склада. Метка — как у остальных правок заявки из справочника. */
export function reassignSupplyCategory(db: Db, fromId: unknown, toId: unknown) {
  return db.collection('supplyrequests').updateMany({ categoryId: fromId }, { $set: { categoryId: toId, editedInApp: true } });
}

/** Единица заявки. Повтор пишет то же сокращение. */
export function reassignSupplyUnit(db: Db, values: readonly string[], symbol: string) {
  return db.collection('supplyrequests').updateMany({ unit: { $in: values } }, { $set: { unit: symbol, editedInApp: true } });
}

/** Цвет заявки. Сравнение как у справочника (`sameRe`), не точная строка массива склада. */
export function renameSupplyColor(db: Db, fromName: unknown, toName: string) {
  return db.collection('supplyrequests').updateMany({ color: sameRe(fromName) }, { $set: { color: toName, editedInApp: true } });
}

/**
 * «Кто подал»: в заявке строка «Имя Фамилия», оба порядка. Сессию не открываем.
 * Повтор с тем же именем находит 0 новых строк.
 */
export function renameSupplyRequestedBy(db: Db, names: readonly string[], target: string) {
  return db.collection('supplyrequests').updateMany({ requestedBy: { $in: [...names] } }, { $set: { requestedBy: target, editedInApp: true } });
}

/**
 * Объединение поставщиков: заявки уже отобранного поставщика.
 * Сессия обязательна: вместе со счетами и карточкой, иначе перенос порвётся.
 */
export function reassignSupplySupplier(db: Db, ids: readonly unknown[], from: unknown, to: unknown, session: ClientSession) {
  return db.collection('supplyrequests').updateMany(
    { _id: { $in: [...ids] as Types.ObjectId[] }, supplierId: from as Types.ObjectId },
    { $set: { supplierId: to, editedInApp: true } },
    { session },
  );
}

/** Подпись заказчика на заявках, которые каскад уже отобрал. Чужие заявки фильтр не берёт. */
export function renameSupplyOrderLabel(db: Db, ids: readonly unknown[], to: string, session: ClientSession) {
  return db.collection('supplyrequests').updateMany(
    { _id: { $in: [...ids] as Types.ObjectId[] } },
    { $set: { orderLabel: to, editedInApp: true } },
    { session },
  );
}

/**
 * Перенос позиции заказа: заявка указывает на новый договор.
 * Сессия вместе со строкой дохода. Повтор пишет тот же id.
 */
export function moveSupplyRequestsToOrder(db: Db, lineId: unknown, orderId: unknown, session: ClientSession) {
  return db.collection('supplyrequests').updateMany({ salesOrderLineId: lineId }, { $set: { salesOrderId: orderId } }, { session });
}
