import mongoose, { Types, type Model } from 'mongoose';
import { Product, ProductSchema, type ProductDocument } from '../../modules/product/product.schema';
import { ProductModule, ProductModuleSchema, type ProductModuleDocument } from '../../modules/product-module/product-module.schema';

export interface TZCatalog304MigrationOptions { dryRun?: boolean; }

export interface TZCatalog304MigrationResult {
  dryRun: boolean;
  productsScanned: number;
  modulesScanned: number;
  productsSkipped: number;
  modulesSkipped: number;
  productLines: number;
  moduleLines: number;
  modifiedProducts: number;
  modifiedModules: number;
}

type LegacyModule = { materialId: Types.ObjectId; quantity?: number; unit?: string; isPurchased?: boolean; overrideDimensions?: { length?: number; width?: number; height?: number; unit?: string }; sortOrder?: number };

/**
 * TZ-CATALOG-304 migration.
 *
 * Composition is migrated only when it is empty. This skip-if-nonempty rule is
 * deliberate: it prevents a partially edited canonical composition from being
 * silently merged with legacy data and makes a second apply a zero-change run.
 * Legacy fields remain in Mongo for the read fallback and the cleanup successor.
 */
export async function runTZCatalog304CompositionMigration(
  productModel: Model<ProductDocument>,
  moduleModel: Model<ProductModuleDocument>,
  options: TZCatalog304MigrationOptions = {},
): Promise<TZCatalog304MigrationResult> {
  const dryRun = options.dryRun ?? false;
  const result: TZCatalog304MigrationResult = {
    dryRun,
    productsScanned: 0,
    modulesScanned: 0,
    productsSkipped: 0,
    modulesSkipped: 0,
    productLines: 0,
    moduleLines: 0,
    modifiedProducts: 0,
    modifiedModules: 0,
  };

  const modules = await moduleModel.find().select('_id composition materials').lean().exec();
  result.modulesScanned = modules.length;
  for (const module of modules) {
    if (module.composition?.length) {
      result.modulesSkipped += 1;
      continue;
    }
    const legacy = (module.materials ?? []) as LegacyModule[];
    if (legacy.length === 0) continue;
    const composition = legacy.map((line, index) => ({
      _id: new Types.ObjectId(),
      lineType: 'material' as const,
      refId: new Types.ObjectId(String(line.materialId)),
      quantity: line.quantity ?? 1,
      sortOrder: line.sortOrder ?? index,
      unit: line.unit,
      isPurchased: line.isPurchased,
      overrideDimensions: line.overrideDimensions,
    }));
    result.moduleLines += composition.length;
    if (!dryRun) {
      const update = await moduleModel.updateOne({ _id: module._id, composition: { $size: 0 } }, { $set: { composition } }).exec();
      result.modifiedModules += update.modifiedCount ?? 0;
    }
  }

  const products = await productModel.find().select('_id composition productModuleIds').lean().exec();
  result.productsScanned = products.length;
  for (const product of products) {
    if (product.composition?.length) {
      result.productsSkipped += 1;
      continue;
    }
    const legacy = product.productModuleIds ?? [];
    if (legacy.length === 0) continue;
    const composition = legacy.map((moduleId, index) => ({
      _id: new Types.ObjectId(),
      lineType: 'module' as const,
      refId: new Types.ObjectId(String(moduleId)),
      quantity: 1,
      sortOrder: index,
    }));
    result.productLines += composition.length;
    if (!dryRun) {
      const update = await productModel.updateOne({ _id: product._id, composition: { $size: 0 } }, { $set: { composition } }).exec();
      result.modifiedProducts += update.modifiedCount ?? 0;
    }
  }

  console.log(`[TZ-CATALOG-304] ${dryRun ? 'dry-run' : 'apply'}: modules=${result.modulesScanned}, products=${result.productsScanned}, moduleLines=${result.moduleLines}, productLines=${result.productLines}, modifiedModules=${result.modifiedModules}, modifiedProducts=${result.modifiedProducts}, skippedModules=${result.modulesSkipped}, skippedProducts=${result.productsSkipped}`);
  return result;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const productModel = mongoose.model(Product.name, ProductSchema) as unknown as Model<ProductDocument>;
      const moduleModel = mongoose.model(ProductModule.name, ProductModuleSchema) as unknown as Model<ProductModuleDocument>;
      await runTZCatalog304CompositionMigration(productModel, moduleModel, { dryRun });
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error: unknown) => {
    console.error('[TZ-CATALOG-304] migration failed', error);
    process.exitCode = 1;
  });
}
