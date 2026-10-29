import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { ProductAlias, ProductAliasSchema } from './product-alias.schema';

/** /api/matching — сопоставление позиций договора с изделиями; коллекция data-core `productaliases`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: ProductAlias.name, schema: ProductAliasSchema }]), AuditModule],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}
