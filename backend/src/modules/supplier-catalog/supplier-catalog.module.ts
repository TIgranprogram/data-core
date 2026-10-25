import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplierItem, SupplierItemSchema } from './schemas/supplier-item.schema';
import { Organization, OrganizationSchema } from '../organization/organization.schema';
import { SupplierCatalogController } from './supplier-catalog.controller';
import { SupplierCatalogService } from './supplier-catalog.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplierItem.name, schema: SupplierItemSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [SupplierCatalogController],
  providers: [SupplierCatalogService],
  exports: [SupplierCatalogService],
})
export class SupplierCatalogModule {}
