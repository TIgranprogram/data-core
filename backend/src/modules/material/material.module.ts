import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Material, MaterialSchema } from './material.schema';
import { MaterialService } from './material.service';
import { MaterialPrice, MaterialPriceSchema } from './material-price.schema';
import { MaterialPriceService } from './material-price.service';
import { MaterialController } from './material.controller';
import { CounterModule } from '../counter/counter.module';
import { Category, CategorySchema } from '../category/category.schema';
import { CatalogGraphModule } from '../../common/catalog/catalog-graph.module';
import { CompositionLineService } from '../../common/catalog/composition-line.service';

@Module({
  imports: [
    CounterModule,
    CatalogGraphModule,
    MongooseModule.forFeature([
      { name: Material.name, schema: MaterialSchema },
      { name: MaterialPrice.name, schema: MaterialPriceSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  controllers: [MaterialController],
  providers: [MaterialService, MaterialPriceService, CompositionLineService],
  exports: [MaterialService, MaterialPriceService, MongooseModule],
})
export class MaterialModule {}
