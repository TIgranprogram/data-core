import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import type { ArticleDecision } from './article';
import { normText } from '../../common/text/norm-text';
import type { StockScope } from '../../common/stock-scope';
import { StockCatalogService } from './stock-catalog.service';
import { StockCompositionService } from './stock-composition.service';
import { StockCoreService } from './stock-core.service';
import { StockMovementsService } from './stock-movements.service';
import { StockReservationsService } from './stock-reservations.service';
import { StockSearchService } from './stock-search.service';
import { StockSpecService } from './stock-spec.service';
import type { MoveInput, StockItemInput } from './stock.types';

export { countGuard } from './stock.types';
export type { MoveInput, MoveType, StockItemInput } from './stock.types';

/**
 * Склад на ОБЩИХ коллекциях CRM: `materials` + `storageitems` + `stockmovements` + `reservations`.
 * Правила изменения остатка — как в StockMovementService / StorageItemService / ReservationService kppdf.
 *
 * StockService — публичный ФАСАД (контроллер и другие модули зовут только его); логика разнесена (АБЗ-5):
 *
 * | метод                                                                                   | файл                          |
 * |-----------------------------------------------------------------------------------------|-------------------------------|
 * | defaultWarehouse, listWarehouses, (loadStorage, markEdited, issuedNames)               | stock-core.service.ts         |
 * | listItems, getItem, openRequests, itemOrdered, categorySummary, totals                  | stock-search.service.ts       |
 * | createItem, updateItem, addPhoto, mainPhoto, removePhoto, removeItem, restoreItem, findMaterialByName, autoArticle, skuFor, adoptArticle | stock-catalog.service.ts |
 * | move, batch, cancelBatch, cancelMovement, listMovements, history, offcut                | stock-movements.service.ts    |
 * | reserveList, listReservations, releaseReservation, releaseGroup, issueReservations, reservationDetail, updateReservation, reservationsByOrder, issueOrder | stock-reservations.service.ts |
 * | specPreview, specApply (спецификация Excel → брони, SK-6)                               | stock-spec.service.ts         |
 * | compositionSuggest, compositionAccept (состав изделия из выдач, SK-7)                   | stock-composition.service.ts  |
 *
 * Зависимости слоями (без циклов): core ← search ← catalog ← movements ← reservations ← spec.
 * Типы (MoveInput, StockItemInput…) и countGuard — в stock.types.ts, реэкспортируются отсюда.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly core: StockCoreService,
    private readonly search: StockSearchService,
    private readonly catalog: StockCatalogService,
    private readonly moves: StockMovementsService,
    private readonly resv: StockReservationsService,
    private readonly spec: StockSpecService,
    private readonly composition: StockCompositionService,
  ) {}

  // --- склад
  defaultWarehouse() { return this.core.defaultWarehouse(); }
  listWarehouses() { return this.core.listWarehouses(); }
  issuedNames(docs: Parameters<StockCoreService['issuedNames']>[0]) { return this.core.issuedNames(docs); }
  totals() { return this.search.totals(); }

  // --- чтение позиций
  listItems(q: Parameters<StockSearchService['listItems']>[0] = {}, scope?: StockScope | null) { return this.search.listItems(q, scope); }
  lookup(scope: StockScope | null) { return this.search.lookup(scope); }
  openRequests(mats: { _id: Types.ObjectId; name?: string }[]) { return this.search.openRequests(mats); }
  itemOrdered(materialId: string, canMoney: boolean, scope: StockScope | null) { return this.search.itemOrdered(materialId, canMoney, scope); }
  categorySummary(scope: StockScope | null) { return this.search.categorySummary(scope); }
  getItem(materialId: string, scope?: StockScope | null) { return this.search.getItem(materialId, scope); }

  // --- карточка позиции
  findMaterialByName(name: string) { return this.catalog.findMaterialByName(name); }
  autoArticle() { return this.catalog.autoArticle(); }
  skuFor(categoryId?: Types.ObjectId) { return this.catalog.skuFor(categoryId); }
  createItem(dto: StockItemInput, scope?: StockScope | null) { return this.catalog.createItem(dto, scope); }
  /** Запись по чужой позиции — 403 (null — доступ полный). */
  assertInScope(materialIds: string[], scope: StockScope | null) { return this.catalog.assertInScope(materialIds, scope); }
  scopeNewItem(dto: StockItemInput, scope: StockScope) { return this.catalog.scopeNewItem(dto, scope); }
  updateItem(materialId: string, dto: StockItemInput) { return this.catalog.updateItem(materialId, dto); }
  addPhoto(materialId: string, photoId: string) { return this.catalog.addPhoto(materialId, photoId); }
  removePhoto(materialId: string, photoId: string) { return this.catalog.removePhoto(materialId, photoId); }
  mainPhoto(materialId: string, photoId: string) { return this.catalog.mainPhoto(materialId, photoId); }
  removeItem(materialId: string) { return this.catalog.removeItem(materialId); }
  restoreItem(materialId: string) { return this.catalog.restoreItem(materialId); }
  adoptArticle(materialId: Types.ObjectId | string, incoming: unknown, source: string): Promise<ArticleDecision> { return this.catalog.adoptArticle(materialId, incoming, source); }

  // --- движения
  move(materialId: string, dto: MoveInput, userId?: string, first?: (session: ClientSession) => Promise<void>) { return this.moves.move(materialId, dto, userId, first); }
  batch(dto: Parameters<StockMovementsService['batch']>[0], userId?: string) { return this.moves.batch(dto, userId); }
  cancelBatch(batchId: string, userId: string | undefined, scope: StockScope | null) { return this.moves.cancelBatch(batchId, userId, scope); }
  offcut(materialId: string, dto: Parameters<StockMovementsService['offcut']>[1], userId?: string) { return this.moves.offcut(materialId, dto, userId); }
  history(materialId: string, limit: number | undefined, scope: StockScope | null) { return this.moves.history(materialId, limit, scope); }
  listMovements(q: Record<string, unknown>, scope: StockScope | null) { return this.moves.listMovements(q, scope); }
  movementMaterialId(id: string) { return this.moves.movementMaterialId(id); }
  correctMovement(id: string, qty: number, userId?: string) { return this.moves.correctMovement(id, qty, userId); }
  cancelMovement(id: string, userId?: string) { return this.moves.cancelMovement(id, userId); }

  // --- брони
  reserveList(dto: Parameters<StockReservationsService['reserveList']>[0], userId?: string) { return this.resv.reserveList(dto, userId); }
  listReservations(scope: StockScope | null) { return this.resv.listReservations(scope); }
  assertReservationsInScope(q: { ids?: string[]; salesOrderId?: string }, scope: StockScope | null) { return this.resv.assertReservationsInScope(q, scope); }
  releaseReservation(id: string) { return this.resv.releaseReservation(id); }
  releaseGroup(batchId: string, scope: StockScope | null) { return this.resv.releaseGroup(batchId, scope); }
  issueReservations(dto: Parameters<StockReservationsService['issueReservations']>[0], userId?: string) { return this.resv.issueReservations(dto, userId); }
  reservationDetail(key: string, scope: StockScope | null) { return this.resv.reservationDetail(key, scope); }
  updateReservation(id: string, dto: Parameters<StockReservationsService['updateReservation']>[1]) { return this.resv.updateReservation(id, dto); }
  reservationsByOrder(salesOrderId: string, scope: StockScope | null) { return this.resv.reservationsByOrder(salesOrderId, scope); }
  issueOrder(dto: Parameters<StockReservationsService['issueOrder']>[0], userId?: string) { return this.resv.issueOrder(dto, userId); }

  // --- спецификация Excel
  specPreview(dto: Parameters<StockSpecService['preview']>[0], scope: StockScope | null) { return this.spec.preview(dto, scope); }
  specApply(dto: Parameters<StockSpecService['apply']>[0], userId: string | undefined, scope: StockScope | null) { return this.spec.apply(dto, userId, scope); }

  // --- состав изделия из выдач (SK-7)
  compositionSuggest(salesOrderLineId: string, money: boolean, scope: StockScope | null) { return this.composition.suggest(salesOrderLineId, money, scope); }
  compositionAccept(dto: Parameters<StockCompositionService['accept']>[0], money: boolean, scope: StockScope | null) { return this.composition.accept(dto, money, scope); }

  static norm = normText;
}
