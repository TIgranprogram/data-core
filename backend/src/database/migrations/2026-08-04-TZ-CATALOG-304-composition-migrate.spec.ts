import { Types } from 'mongoose';
import { runTZCatalog304CompositionMigration } from './2026-08-04-TZ-CATALOG-304-composition-migrate';

function query<T>(value: T) { return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) }; }
function model<T>(rows: T[]) { return { find: jest.fn().mockReturnValue(query(rows)), updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })) } as any; }

describe('TZ-CATALOG-304 composition migration', () => {
  it('dry-run reports lines without writing', async () => {
    const materialId = new Types.ObjectId(); const moduleId = new Types.ObjectId();
    const modules = model([{ _id: moduleId, composition: [], materials: [{ materialId, quantity: 2, unit: 'шт' }] }]);
    const products = model([{ _id: new Types.ObjectId(), composition: [], productModuleIds: [moduleId] }]);
    const result = await runTZCatalog304CompositionMigration(products, modules, { dryRun: true });
    expect(result.moduleLines).toBe(1); expect(result.productLines).toBe(1); expect(result.modifiedModules).toBe(0); expect(result.modifiedProducts).toBe(0); expect(modules.updateOne).not.toHaveBeenCalled(); expect(products.updateOne).not.toHaveBeenCalled();
  });

  it('apply maps legacy rows and a second run has no changes', async () => {
    const materialId = new Types.ObjectId(); const moduleId = new Types.ObjectId();
    const moduleRows: Array<{ _id: Types.ObjectId; composition: unknown[]; materials: Array<{ materialId: Types.ObjectId; quantity: number; unit: string }> }> = [{ _id: new Types.ObjectId(), composition: [], materials: [{ materialId, quantity: 2, unit: 'шт' }] }];
    const productRows: Array<{ _id: Types.ObjectId; composition: unknown[]; productModuleIds: Types.ObjectId[] }> = [{ _id: new Types.ObjectId(), composition: [], productModuleIds: [moduleId] }];
    const modules = model(moduleRows); const products = model(productRows);
    const first = await runTZCatalog304CompositionMigration(products, modules);
    expect(first.moduleLines).toBe(1); expect(first.productLines).toBe(1); expect(modules.updateOne).toHaveBeenCalledTimes(1); expect(products.updateOne).toHaveBeenCalledTimes(1);
    moduleRows[0].composition = [{ _id: new Types.ObjectId(), lineType: 'material', refId: materialId, quantity: 2, sortOrder: 0 }];
    productRows[0].composition = [{ _id: new Types.ObjectId(), lineType: 'module', refId: moduleId, quantity: 1, sortOrder: 0 }];
    const second = await runTZCatalog304CompositionMigration(products, modules);
    expect(second.moduleLines).toBe(0); expect(second.productLines).toBe(0); expect(second.modulesSkipped).toBe(1); expect(second.productsSkipped).toBe(1);
  });
});
