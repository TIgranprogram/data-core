import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Types, type Connection } from 'mongoose';
import { STOCK_VISIBLE } from '../../common/catalog/stock-visible';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { oid } from '../../common/list-query';
import { inScope, type StockScope } from '../../common/stock-scope';

@ApiTags('Склад')
@AppSection('stock')
@Controller('stock/duplicate-preview')
export class StockDuplicatePreviewController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Сравнить две позиции и их складские связи без изменений в базе' })
  @ApiQuery({ name: 'sourceId', type: String })
  @ApiQuery({ name: 'targetId', type: String })
  async preview(@Query('sourceId') source: string, @Query('targetId') target: string, @StockScoped() scope: StockScope | null) {
    const ids = [oid(source, 'дубля'), oid(target, 'основной позиции')];
    if (ids[0].equals(ids[1])) throw new BadRequestException('Выберите две разные позиции');
    const db = this.connection.db!;
    const keys = [...ids, ...ids.map(String)];
    const materials = await db.collection('materials').find(
      { _id: { $in: ids }, deletedAt: null, ...STOCK_VISIBLE },
      { projection: { name: 1, fullName: 1, article: 1, unit: 1, categoryId: 1, dimensions: 1, materialGrade: 1, standardRef: 1 } },
    ).toArray();
    if (materials.length !== 2) throw new NotFoundException('Одна из складских позиций не найдена');
    if (materials.some((row) => !inScope(scope, row))) throw new ForbiddenException('Одна из позиций не из вашего склада');

    const counts = async (collection: string) => db.collection(collection).aggregate<{ _id: string; total: number }>([
      { $match: { materialId: { $in: keys } } },
      { $group: { _id: { $toString: '$materialId' }, total: { $sum: 1 } } },
    ]).toArray();
    const [placements, movements, reservations, requests] = await Promise.all([
      db.collection('storageitems').aggregate<{
        _id: { materialId: string; warehouseId: Types.ObjectId | null; zone: string };
        quantity: number;
        reserved: number;
      }>([
        { $match: { materialId: { $in: keys }, deletedAt: null } },
        { $group: {
          _id: { materialId: { $toString: '$materialId' }, warehouseId: '$warehouseId', zone: { $ifNull: ['$zoneName', ''] } },
          quantity: { $sum: '$quantity' }, reserved: { $sum: '$reservedQty' },
        } },
      ]).toArray(),
      counts('stockmovements'),
      counts('reservations'),
      counts('supplyrequests'),
    ]);
    const warehouseIds = placements.map((row) => row._id.warehouseId).filter((id): id is Types.ObjectId => id !== null);
    const warehouses = await db.collection('warehouses').find({ _id: { $in: warehouseIds } }, { projection: { name: 1 } }).toArray();
    const warehouseName = new Map(warehouses.map((row) => [String(row._id), String(row.name ?? '')]));
    const preview = ids.map(String).map((id) => {
      const material = materials.find((row) => String(row._id) === id)!;
      return {
        id, name: material.name, fullName: material.fullName ?? null, article: material.article ?? null,
        unit: material.unit ?? '', dimensions: material.dimensions ?? [], grade: material.materialGrade ?? '', standard: material.standardRef ?? '',
        placements: placements.filter((row) => row._id.materialId === id).map((row) => ({
          warehouseId: row._id.warehouseId, warehouse: warehouseName.get(String(row._id.warehouseId)) ?? 'Неизвестный склад',
          zone: row._id.zone, quantity: row.quantity, reserved: row.reserved,
        })),
        movements: movements.find((row) => row._id === id)?.total ?? 0,
        reservations: reservations.find((row) => row._id === id)?.total ?? 0,
        requests: requests.find((row) => row._id === id)?.total ?? 0,
      };
    });
    const blockers = ['Общий склад и CRM используют разные механизмы записи. Перенос остатков и истории пока недоступен.'];
    if (String(preview[0].unit).trim() !== String(preview[1].unit).trim()) {
      blockers.push('У позиций разные единицы измерения.');
    }
    return { items: preview, canMerge: false, blockers };
  }
}
