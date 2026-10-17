import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ProductController } from '../product/product.controller';
import { MaterialController } from '../material/material.controller';
import { ProductModuleController } from '../product-module/product-module.controller';
import { WorkTypeController } from '../work-type/work-type.controller';
import { CategoryController } from '../category/category.controller';
import { ProductModuleService } from '../product-module/product-module.service';
import { MaterialService } from '../material/material.service';
import { WorkTypeService } from '../work-type/work-type.service';
import { ProductModuleSchema } from '../product-module/product-module.schema';
import { ProductSchema } from '../product/product.schema';
import { MaterialSchema } from '../material/material.schema';
import { WorkTypeSchema } from '../work-type/work-type.schema';
import { CategorySchema } from '../category/category.schema';

function execChain<T>(value: T) {
  return { populate: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function archiveDb(matchByCollection: Record<string, unknown> = {}) {
  let selectedCollection = '';
  const findOne = jest.fn(async (): Promise<unknown> => matchByCollection[selectedCollection] ?? null);
  const collection = jest.fn((name: string) => { selectedCollection = name; return { findOne }; });
  return { collection };
}

describe('TZ-CATALOG-314 archive contracts', () => {
  it('adds nullable archive markers without removing legacy schema fields', () => {
    expect(ProductModuleSchema.path('deletedAt')).toBeDefined();
    expect(ProductModuleSchema.path('photoIds')).toBeDefined();
    expect(ProductSchema.path('deletedAt')).toBeDefined();
    expect(MaterialSchema.path('deletedAt')).toBeDefined();
    expect(WorkTypeSchema.path('deletedAt')).toBeDefined();
    expect(CategorySchema.path('deletedAt')).toBeDefined();
  });

  it('archives an unreferenced ProductModule without hard deletion', async () => {
    const id = new Types.ObjectId();
    const moduleDoc = { _id: id, deletedAt: null };
    const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
    const model = { findById: jest.fn().mockReturnValue(execChain(moduleDoc)), updateOne, db: archiveDb() };
    const service = new ProductModuleService(model as never, {} as never, {} as never, {} as never, undefined, {} as never, {} as never);
    await service.remove(id.toString());
    expect(updateOne).toHaveBeenCalledWith({ _id: id, deletedAt: null }, { $set: { deletedAt: expect.any(Date) } });
    expect(moduleDoc.deletedAt).toBeNull();
  });

  it('blocks ProductModule archive when a BOM references the module', async () => {
    const id = new Types.ObjectId();
    const model = { findById: jest.fn().mockReturnValue(execChain({ _id: id, deletedAt: null })), updateOne: jest.fn(), db: archiveDb({ boms: { _id: new Types.ObjectId() } }) };
    const service = new ProductModuleService(model as never, {} as never, {} as never, {} as never, undefined, {} as never, {} as never);
    await expect(service.remove(id.toString())).rejects.toBeInstanceOf(ConflictException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('blocks Material archive when a cost calculation references it', async () => {
    const id = new Types.ObjectId();
    const model = { findById: jest.fn().mockReturnValue(execChain({ _id: id, deletedAt: null })), updateOne: jest.fn(), db: archiveDb({ costcalculations: { _id: new Types.ObjectId() } }) };
    const service = new MaterialService(model as never, { findById: jest.fn() } as never, {} as never, {} as never, undefined);
    await expect(service.remove(id.toString())).rejects.toBeInstanceOf(ConflictException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('blocks WorkType archive when a historical labor row references it', async () => {
    const id = new Types.ObjectId();
    const model = { findOne: jest.fn().mockReturnValue(execChain({ _id: id, deletedAt: null })), findById: jest.fn(), updateOne: jest.fn(), db: archiveDb({ costcalculations: { _id: new Types.ObjectId() } }) };
    const service = new WorkTypeService(model as never);
    await expect(service.remove(id.toString())).rejects.toBeInstanceOf(ConflictException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('keeps explicit admin/manager mutation roles on catalog delete routes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProductController.prototype.remove)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(ROLES_KEY, MaterialController.prototype.remove)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(ROLES_KEY, ProductModuleController.prototype.remove)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WorkTypeController.prototype.remove)).toEqual([
      'production:write',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CategoryController.prototype.remove)).toEqual(['admin']);
  });

  it('forwards the authenticated organization to Product and Material list services', () => {
    const productService = { findAll: jest.fn() };
    const productController = new ProductController(productService as never, {} as never);
    const user = { organizationId: new Types.ObjectId().toHexString() };
    productController.list(user as never);
    expect(productService.findAll).toHaveBeenCalledWith(expect.any(Object), user.organizationId);

    const materialService = { findAll: jest.fn() };
    const materialController = new MaterialController(materialService as never, {} as never);
    materialController.list(user as never);
    expect(materialService.findAll).toHaveBeenCalledWith(expect.any(Object), user.organizationId);
  });

  it('forwards the authenticated organization to Category list service', () => {
    const categoryService = { findAll: jest.fn() };
    const controller = new CategoryController(categoryService as never);
    const user = { organizationId: new Types.ObjectId().toHexString() };
    controller.list(user as never);
    expect(categoryService.findAll).toHaveBeenCalledWith(undefined, user.organizationId);
  });
});
