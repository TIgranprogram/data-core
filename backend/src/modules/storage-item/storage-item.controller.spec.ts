import { StorageItemController } from './storage-item.controller';
import { StorageItemService } from './storage-item.service';

/**
 * TZ-MATERIALS-308 — envelope-контракт GET /storage-items.
 *
 * FE (PiEntityListComponent / inventory-dashboard) ожидает { items, total },
 * ранее бэкенд отдавал голый массив (TZ-232.C mismatch). Контроллер теперь
 * оборачивает сервисный массив в canonical envelope.
 */
describe('StorageItemController (TZ-MATERIALS-308)', () => {
  function buildService(overrides: Partial<StorageItemService> = {}) {
    return {
      findAll: jest.fn().mockResolvedValue([
        { _id: 'si1', quantity: 7, materialId: { _id: 'm1', name: 'Стекло' } },
        { _id: 'si2', quantity: 3, productId: { _id: 'p1', name: 'Столешница' } },
      ]),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      adjust: jest.fn(),
      remove: jest.fn(),
      ...overrides,
    } as unknown as StorageItemService;
  }

  it('GET /storage-items возвращает envelope { items, total } (не голый массив)', async () => {
    const findAll = jest.fn().mockResolvedValue([{ _id: 'si1' }, { _id: 'si2' }]);
    const controller = new StorageItemController(buildService({ findAll }));

    const out = await controller.findAll(undefined, undefined, undefined, undefined);
    expect(findAll).toHaveBeenCalledWith(undefined, undefined, false, undefined);
    expect(out).toEqual({ items: [{ _id: 'si1' }, { _id: 'si2' }], total: 2 });
  });

  it('прокидывает materialId-фильтр в сервис и total = длине результата', async () => {
    const findAll = jest.fn().mockResolvedValue([{ _id: 'si1', materialId: 'm1' }]);
    const controller = new StorageItemController(buildService({ findAll }));

    const out = await controller.findAll(undefined, undefined, 'm1', undefined);
    expect(findAll).toHaveBeenCalledWith(undefined, undefined, false, 'm1');
    expect(out).toEqual({ items: [{ _id: 'si1', materialId: 'm1' }], total: 1 });
  });

  it('lowStock=true прокидывается как boolean', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const controller = new StorageItemController(buildService({ findAll }));

    await controller.findAll(undefined, undefined, undefined, 'true');
    expect(findAll).toHaveBeenCalledWith(undefined, undefined, true, undefined);
  });

  it('POST /materials/:id/storage-items делегирует в create с materialId', async () => {
    const create = jest.fn().mockResolvedValue({ _id: 'si9', materialId: 'm1' });
    const controller = new StorageItemController(buildService({ create }));

    const dto = { warehouseId: 'w1', quantity: 5 } as never;
    const out = await controller.createForMaterial('m1', dto);
    expect(create).toHaveBeenCalledWith({ warehouseId: 'w1', quantity: 5, materialId: 'm1' });
    expect(out).toEqual({ _id: 'si9', materialId: 'm1' });
  });
});
