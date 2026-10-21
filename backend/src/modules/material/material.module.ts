import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Material, MaterialSchema } from './material.schema';
import { MaterialService } from './material.service';
import { MaterialController } from './material.controller';
import { CounterModule } from '../counter/counter.module';
import { Category, CategorySchema } from '../category/category.schema';
import { CatalogGraphModule } from '../catalog-graph/catalog-graph.module';
import { CompositionLineService } from '../catalog/composition-line.service';

@Module({
  imports: [
    CounterModule,
    CatalogGraphModule,
    MongooseModule.forFeature([
      { name: Material.name, schema: MaterialSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  controllers: [MaterialController],
  providers: [MaterialService, CompositionLineService],
  exports: [MaterialService, MongooseModule],
})
export class MaterialModule {}
