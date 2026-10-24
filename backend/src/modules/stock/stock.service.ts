import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import type { ArticleDecision } from './article';
import { normText } from '../../common/text/norm-text';
import { StockCatalogService } from './stock-catalog.service';
import { StockCoreService } from './stock-core.service';
import { StockMovementsService } from './stock-movements.service';
import { StockReservationsService } from './stock-reservations.service';
import { StockSearchService } from './stock-search.service';
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
 * | defaultWarehouse, listWarehouses, (loadStorage, markEdited, issueTarget, issuedNames)   | stock-core.service.ts         |
 * | listItems, getItem, openRequests, itemOrdered, categorySummary, totals                  | stock-search.service.ts       |
 * | createItem, updateItem, addPhoto, removePhoto, removeItem, restoreItem, findMaterialByName, autoArticle, skuFor, adoptArticle | stock-catalog.service.ts |
 * | move, batch, cancelBatch, cancelMovement, listMovements, history, offcut                | stock-movements.service.ts    |
 * | reserveList, listReservations, releaseReservation, releaseGroup, issueReservations, reservationDetail | stock-reservations.service.ts |
 *
 * Зависимости слоями (без циклов): core ← search ← catalog ← movements ← reservations.
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
  ) {}

  // --- склад
  defaultWarehouse() { return this.core.defaultWarehouse(); }
  listWarehouses() { return this.core.listWarehouses(); }
  issuedNames(docs: Parameters<StockCoreService['issuedNames']>[0]) { return this.core.issuedNames(docs); }
  totals() { return this.search.totals(); }

  // --- чтение позиций
  listItems(q: Parameters<StockSearchService['listItems']>[0] = {}) { return this.search.listItems(q); }
  openRequests(mats: { _id: Types.ObjectId; name?: string }[]) { return this.search.openRequests(mats); }
  itemOrdered(materialId: string, canMoney: boolean) { return this.search.itemOrdered(materialId, canMoney); }
  categorySummary() { return this.search.categorySummary(); }
  getItem(materialId: string) { return this.search.getItem(materialId); }

  // --- карточка позиции
  findMaterialByName(name: string) { return this.catalog.findMaterialByName(name); }
  autoArticle() { return this.catalog.autoArticle(); }
  skuFor(categoryId?: Types.ObjectId) { return this.catalog.skuFor(categoryId); }
  createItem(dto: StockItemInput) { return this.catalog.createItem(dto); }
  updateItem(materialId: string, dto: StockItemInput) { return this.catalog.updateItem(materialId, dto); }
  addPhoto(materialId: string, photoId: string) { return this.catalog.addPhoto(materialId, photoId); }
  removePhoto(materialId: string, photoId: string) { return this.catalog.removePhoto(materialId, photoId); }
  removeItem(materialId: string) { return this.catalog.removeItem(materialId); }
  restoreItem(materialId: string) { return this.catalog.restoreItem(materialId); }
  adoptArticle(materialId: Types.ObjectId | string, incoming: unknown, source: string): Promise<ArticleDecision> { return this.catalog.adoptArticle(materialId, incoming, source); }

  // --- движения
  move(materialId: string, dto: MoveInput, userId?: string) { return this.moves.move(materialId, dto, userId); }
  batch(dto: Parameters<StockMovementsService['batch']>[0], userId?: string) { return this.moves.batch(dto, userId); }
  cancelBatch(batchId: string, userId?: string) { return this.moves.cancelBatch(batchId, userId); }
  offcut(materialId: string, dto: Parameters<StockMovementsService['offcut']>[1], userId?: string) { return this.moves.offcut(materialId, dto, userId); }
  history(materialId: string, limit?: number) { return this.moves.history(materialId, limit); }
  listMovements(q: Record<string, unknown> = {}) { return this.moves.listMovements(q); }
  cancelMovement(id: string, userId?: string) { return this.moves.cancelMovement(id, userId); }

  // --- брони
  reserveList(dto: Parameters<StockReservationsService['reserveList']>[0], userId?: string) { return this.resv.reserveList(dto, userId); }
  listReservations() { return this.resv.listReservations(); }
  releaseReservation(id: string) { return this.resv.releaseReservation(id); }
  releaseGroup(batchId: string) { return this.resv.releaseGroup(batchId); }
  issueReservations(dto: Parameters<StockReservationsService['issueReservations']>[0], userId?: string) { return this.resv.issueReservations(dto, userId); }
  reservationDetail(key: string) { return this.resv.reservationDetail(key); }

  static norm = normText;
}
