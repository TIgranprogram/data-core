import { InventoryController } from './inventory.controller';
import { StorageItemService } from '../storage-item/storage-item.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { StockMovementService } from '../stock-movement/stock-movement.service';

/**
 * TZ-MATERIALS-308 — low-stock отдаёт envelope { items, total }.
 *
 * FE dashboard читает `lowStockRes.value()?.items`; ранее бэкенд отдавал
 * голый массив. Контроллер оборачивает сервисный массив.
 */
describe('InventoryController (TZ-MATERIALS-308)', () => {
  function build() {
    const storage = {
      findAll: jest.fn().mockResolvedValue([
        { _id: 'si1', quantity: 3, minQuantity: 10, materialId: { _id: 'm1' } },
      ]),
    } as unknown as StorageItemService;
    const warehouses = { findAll: jest.fn().mockResolvedValue([]) } as unknown as WarehouseService;
    const movements = {
      findAll: jest.fn().mockResolvedValue([]),
    } as unknown as StockMovementService;
    const controller = new InventoryController(storage, warehouses, movements);
    return { controller, storage, warehouses, movements };
  }

  it('GET /inventory/low-stock возвращает envelope { items, total }', async () => {
    const { controller, storage } = build();
    const out = await controller.lowStock();
    expect(storage.findAll).toHaveBeenCalledWith(undefined, undefined, true);
    expect(out).toEqual({
      items: [{ _id: 'si1', quantity: 3, minQuantity: 10, materialId: { _id: 'm1' } }],
      total: 1,
    });
  });

  it('dashboard агрегирует метрики из массива (без упавшего envelope)', async () => {
    const { controller, storage } = build();
    storage.findAll = jest.fn().mockResolvedValue([
      { _id: 'a', quantity: 5, minQuantity: 1, isActive: true },
      { _id: 'b', quantity: 0, minQuantity: 1, isActive: true },
      { _id: 'c', quantity: 2, minQuantity: 5, isActive: true },
      { _id: 'd', quantity: 1, minQuantity: 0, isActive: false },
    ]) as never;

    const out = (await controller.dashboard()) as Record<string, unknown>;
    // a: qty5>0 active ✓ · b: qty0 (out) ✓ · c: qty2≤min5 (low) ✓ · d: inactive ✗
    expect(out['totalActiveItems']).toBe(2);
    expect(out['outOfStockCount']).toBe(1);
    expect(out['lowStockCount']).toBe(1);
  });
});
