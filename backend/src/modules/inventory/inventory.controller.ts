import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { StorageItemService } from '../storage-item/storage-item.service';
import { StorageItemDocument } from '../storage-item/storage-item.schema';
import { WarehouseService } from '../warehouse/warehouse.service';
import { WarehouseDocument } from '../warehouse/warehouse.schema';
import { StockMovementService } from '../stock-movement/stock-movement.service';

interface WarehouseSummary {
  warehouseId: string;
  warehouseName: string;
  itemCount: number;
}

interface RecentItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  updatedAt: string;
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly storage: StorageItemService,
    private readonly warehouses: WarehouseService,
    private readonly movements: StockMovementService,
  ) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  async dashboard() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      allWarehouses,
      allItems,
      recentMovements,
    ] = await Promise.all([
      this.warehouses.findAll(),
      this.storage.findAll(),
      this.movements.findAll(undefined, undefined, undefined, thirtyDaysAgo),
    ]);

    const activeWarehouses = (allWarehouses as WarehouseDocument[]).filter(
      (w) => w.isActive !== false,
    );
    const activeItems = (allItems as StorageItemDocument[]).filter(
      (i) => i.isActive !== false && (i.quantity ?? 0) > 0,
    );
    const outOfStock = (allItems as StorageItemDocument[]).filter(
      (i) => i.isActive !== false && (i.quantity ?? 0) === 0,
    );
    const lowStock = (allItems as StorageItemDocument[]).filter(
      (i) =>
        i.isActive !== false &&
        (i.quantity ?? 0) > 0 &&
        (i.quantity ?? 0) <= (i.minQuantity ?? 0),
    );

    // Map warehouse names from the already-fetched allWarehouses array
    const whNameMap = new Map<string, string>();
    for (const wh of activeWarehouses) {
      whNameMap.set(String(wh._id), wh.name);
    }

    // Count items per warehouse using raw document data
    const whCounts = new Map<string, { name: string; count: number }>();
    for (const item of activeItems) {
      const raw = item as unknown as Record<string, unknown>;
      const whId = String(raw['warehouseId'] ?? '');
      const whName = whNameMap.get(whId) ?? whId;
      const entry = whCounts.get(whId) ?? { name: whName, count: 0 };
      entry.count++;
      whCounts.set(whId, entry);
    }

    const byWarehouseTop: WarehouseSummary[] = [...whCounts.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 3)
      .map(([warehouseId, { name: warehouseName, count: itemCount }]) => ({
        warehouseId,
        warehouseName,
        itemCount,
      }));

    const recentlyUpdatedItems: RecentItem[] = [...allItems]
      .sort((a, b) => {
        const aRaw = a as unknown as Record<string, unknown>;
        const bRaw = b as unknown as Record<string, unknown>;
        const aDate = new Date(String(aRaw['updatedAt'] ?? 0)).getTime();
        const bDate = new Date(String(bRaw['updatedAt'] ?? 0)).getTime();
        return bDate - aDate;
      })
      .slice(0, 10)
      .map((i) => {
        const raw = i as unknown as Record<string, unknown>;
        const dims = raw['dimensions'] as Record<string, unknown> | undefined;
        return {
          id: String(raw['_id'] ?? ''),
          name: String(raw['name'] ?? ''),
          qty: Number(raw['quantity'] ?? 0),
          unit: String(dims?.unit ?? ''),
          updatedAt: String(raw['updatedAt'] ?? ''),
        };
      });

    return {
      totalWarehouses: activeWarehouses.length,
      totalActiveItems: activeItems.length,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      totalMovementsLast30d: recentMovements.length,
      byWarehouseTop,
      recentlyUpdatedItems,
      asOf: new Date(),
    };
  }

  @Get('low-stock')
  @Roles('admin', 'director', 'manager', 'user')
  async lowStock() {
    // TZ-MATERIALS-308: canonical envelope { items, total } — matches the
    // frontend contract (inventory-dashboard reads .items).
    const items = await this.storage.findAll(undefined, undefined, true);
    return { items, total: items.length };
  }
}
