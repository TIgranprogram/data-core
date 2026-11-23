import { model, Types } from 'mongoose';
import { stockViewsFor } from '../../common/stock-views';
import { RoleService } from './role.service';
import { RoleSchema } from './role.schema';
import { UpdateRoleDto } from './dto/update-role.dto';

const RoleModel = model('C240RoleReset', RoleSchema);

describe('C240 — сохранение настройки экранов и явный возврат к наследованию', () => {
  const fixture = () => {
    const doc = RoleModel.hydrate({
      _id: new Types.ObjectId(), name: 'r-director-stock', label: 'Директор', baseRole: 'director', stockViews: [],
      appSections: ['stock'], warehouseIds: ['111111111111111111111111'], stockCategoryIds: ['222222222222222222222222'],
      money: false, permissions: ['stock.read'], pages: ['stock'], isActive: true,
    });
    const save = jest.spyOn(doc, 'save').mockResolvedValue(doc);
    const service = new RoleService({ findById: jest.fn(() => ({ exec: async () => doc })) } as never);
    return { doc, save, service };
  };
  it('omit сохраняет explicit [], reset делает $unset и восстанавливает наследование директора', async () => {
    const { doc, save, service } = fixture();
    const before = doc.toObject();
    delete before.stockViews;
    expect(stockViewsFor('director', doc.stockViews)).toEqual([]);
    await service.update(String(doc._id), {});
    expect(doc.stockViews).toEqual([]);
    expect(doc.getChanges()).not.toHaveProperty('$unset.stockViews');
    await service.update(String(doc._id), { resetStockViews: true });
    expect(doc.stockViews).toBeUndefined();
    expect(doc.getChanges()).toMatchObject({ $unset: { stockViews: 1 } });
    expect(stockViewsFor('director', doc.stockViews)).toEqual(['pipe', 'sheet']);
    expect(doc).not.toHaveProperty('resetStockViews');
    const after = doc.toObject();
    delete after.stockViews;
    expect(after).toEqual(before);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('защита сервиса от взаимоисключённой/неверной команды до записи', async () => {
    const { save, service } = fixture();
    for (const dto of [{ resetStockViews: true, stockViews: [] }, { resetStockViews: null }, { resetStockViews: false }]) {
      await expect(service.update('id', dto as unknown as UpdateRoleDto)).rejects.toThrow('сброс');
    }
    expect(save).not.toHaveBeenCalled();
  });
});
