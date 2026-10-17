export interface WarehouseItemCount {
  warehouseId: string;
  warehouseName: string;
  itemCount: number;
}

export interface RecentItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  updatedAt: Date;
}

export interface InventoryDashboardSummary {
  totalWarehouses: number;
  totalActiveItems: number;
  outOfStockCount: number;
  lowStockCount: number;
  totalMovementsLast30d: number;
  byWarehouseTop: WarehouseItemCount[];
  recentlyUpdatedItems: RecentItem[];
  asOf: Date;
}
