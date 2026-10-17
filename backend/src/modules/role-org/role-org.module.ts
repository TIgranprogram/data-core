import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleOrg, RoleOrgSchema } from './role-org.schema';
import { RoleOrgService } from './role-org.service';
import { RoleOrgController } from './role-org.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RoleOrg.name, schema: RoleOrgSchema }]),
  ],
  controllers: [RoleOrgController],
  providers: [RoleOrgService],
  exports: [RoleOrgService, MongooseModule],
})
export class RoleOrgModule {}
