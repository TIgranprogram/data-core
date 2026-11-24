/**
 * Контракт полей сырого чтения шести shared-коллекций (C254-0, опора C257).
 * Списки — поля, которые data-core сам называет в проекции `db.collection` или в `$` агрегата.
 * Схему mongoose и метки S/A/G этот файл не меняет. Полный документ без проекции слой не сужает.
 * Чтения своей модели хозяина (stock/supply/material) сюда не сведены.
 */

export type SharedCollection =
  | 'materials'
  | 'storageitems'
  | 'stockmovements'
  | 'reservations'
  | 'warehouses'
  | 'supplyrequests';

export const SHARED_READ_FIELDS: Record<SharedCollection, readonly string[]> = {
  materials: [
    'article', 'assortment', 'categoryId', 'deletedAt', 'dimensions', 'fullName', 'invoiceName',
    'isProfile', 'mainPhotoId', 'materialGrade', 'materialKind', 'name', 'offcutOf', 'photoIds',
    'pricePerUnit', 'shortName', 'standardRef', 'typeName', 'unit', 'weightKg', 'weightUnit',
  ],
  storageitems: ['materialId', 'quantity', 'reservedQty', 'warehouseId', 'zoneName'],
  stockmovements: [
    'cancelOf', 'cancelledAt', 'createdAt', 'createdBy', 'date', 'isReturn', 'issuedTo',
    'issuedToPersonId', 'materialId', 'notes', 'qty', 'reason', 'reservationId', 'salesOrderId',
    'salesOrderLineId', 'type',
  ],
  reservations: [
    'batchId', 'createdAt', 'groupName', 'issuedQty', 'materialId', 'orderId', 'productId',
    'qty', 'salesOrderId', 'status',
  ],
  warehouses: ['name'],
  supplyrequests: [
    'article', 'articleId', 'categoryId', 'companyId', 'costCenter', 'costObject', 'createdAt',
    'deletedAt', 'invoiceDate', 'invoiceId', 'invoiceNo', 'lineTotal', 'materialId', 'neededBy',
    'num', 'paid', 'paidAt', 'photoIds', 'priceHint', 'qty', 'receivedAt', 'receivedQty',
    'requestDate', 'requestedBy', 'responsibleId', 'salesOrderId', 'salesOrderLineId', 'status',
    'supplierId', 'title', 'unit',
  ],
};

/**
 * Поля есть в сыром чтении, в схеме mongoose коллекции их нет.
 * Не ставить required и не копировать в kppdf «для красоты» (L-257).
 * `offcutOf` — только data-core (обрезки). `receivedAt` / `photoIds` заявок и `shortName` позиции читает код, схемы нет.
 */
export const SHARED_READ_OUTSIDE_SCHEMA: Partial<Record<SharedCollection, readonly string[]>> = {
  materials: ['offcutOf', 'shortName'],
  supplyrequests: ['photoIds', 'receivedAt'],
};
