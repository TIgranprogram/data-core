import { Types, type PipelineStage } from 'mongoose';
import { scopeMatch, type StockScope } from '../../common/stock-scope';

const STOCK_TYPES = ['SupplyRequest', 'Material', 'StockMovement'];
// Эти действия относятся к группе записей или к брони, а не к отдельному движению/материалу.
const NON_RECORD_ACTIONS = [
  'bulk', 'stock.item.bulk', 'stock.item.bulk.restore', 'stock.batch', 'stock.batch.cancelled',
  'stock.reserve.list', 'stock.reserve.issued', 'stock.reserve.issued.order', 'stock.reserve.released',
  'stock.reserve.group.released', 'stock.spec.applied',
];

const objectId = (input: unknown) => ({ $convert: { input, to: 'objectId', onError: null, onNull: null } });
const forType = (type: string, id: string) => ({ $cond: [{ $eq: ['$entityType', type] }, id, null] });

/** Проверяем ту же складскую область, что и запрос к materials, на присоединённом материале. */
function materialMatch(filter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filter).map(([field, rule]) => field === '$or' || field === '$and'
    ? [field, (rule as Record<string, unknown>[]).map(materialMatch)]
    : [`_scopeMaterial.${field}`, rule]));
}

function lookupOwner(from: string, localField: string, as: string): PipelineStage[] {
  return [
    { $lookup: { from, localField, foreignField: '_id', as } },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
  ];
}

/** Стадии после фильтров журнала, до страницы, общего числа или авторов. */
export function appJournalStockStages(types: string[], scope: StockScope | null, projection: Record<string, 1>): PipelineStage[] {
  if (!scope || !types.some((type) => STOCK_TYPES.includes(type))) return [];

  const outsideStock = { entityType: { $nin: STOCK_TYPES } };
  const categories: Array<string | Types.ObjectId | null> = scope.categoryIds
    .filter((id) => Types.ObjectId.isValid(id)).flatMap((id) => [id, new Types.ObjectId(id)]);
  if (scope.noCategory) categories.push(null);
  const material = {
    '_scopeMaterial._id': { $type: 'objectId' },
    $expr: { $in: [{ $type: '$_scopeMaterial.categoryId' }, ['missing', 'null', 'objectId', 'string']] },
    ...materialMatch(scopeMatch(scope)),
  };
  const requestWithoutMaterial = {
    entityType: 'SupplyRequest',
    '_scopeRequest._id': { $type: 'objectId' },
    $expr: { $and: [
      { $eq: [{ $ifNull: ['$_scopeRequest.materialId', null] }, null] },
      { $in: [{ $ifNull: ['$_scopeRequest.categoryId', null] }, categories] },
    ] },
  };

  return [
    { $match: { $or: [outsideStock, {
      action: { $nin: NON_RECORD_ACTIONS },
      // Массовое создание и одна заявка исторически используют один action.
      $nor: [{ entityType: 'SupplyRequest', 'details.after.items': { $type: 'array' } }],
    }] } },
    { $project: projection },
    { $set: { _scopeEntityId: objectId({ $ifNull: ['$entityId', '$details.id'] }) } },
    { $set: {
      _scopeRequestId: forType('SupplyRequest', '$_scopeEntityId'),
      _scopeMovementId: forType('StockMovement', '$_scopeEntityId'),
    } },
    ...lookupOwner('supplyrequests', '_scopeRequestId', '_scopeRequest'),
    ...lookupOwner('stockmovements', '_scopeMovementId', '_scopeMovement'),
    { $set: { _scopeMaterialId: { $switch: { branches: [
      { case: { $eq: ['$entityType', 'Material'] }, then: '$_scopeEntityId' },
      { case: { $eq: ['$entityType', 'StockMovement'] }, then: objectId('$_scopeMovement.materialId') },
      { case: { $eq: ['$entityType', 'SupplyRequest'] }, then: objectId('$_scopeRequest.materialId') },
    ], default: null } } } },
    ...lookupOwner('materials', '_scopeMaterialId', '_scopeMaterial'),
    { $match: { $or: [outsideStock, {
      _scopeEntityId: { $type: 'objectId' }, $or: [material, requestWithoutMaterial],
    }] } },
    { $project: projection },
  ];
}
