import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleCounterparty, RoleCounterpartySchema } from './role-counterparty.schema';
import { RoleCounterpartyService } from './role-counterparty.service';
import { RoleCounterpartyController } from './role-counterparty.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RoleCounterparty.name, schema: RoleCounterpartySchema }]),
  ],
  controllers: [RoleCounterpartyController],
  providers: [RoleCounterpartyService],
  exports: [RoleCounterpartyService, MongooseModule],
})
export class RoleCounterpartyModule {}
