import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { Handoff, HandoffSchema, Zone, ZoneAssignment, ZoneAssignmentSchema, ZoneSchema } from './zone.schema';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

/** /api/zones, /api/staff, /api/handoffs — зоны ответственности, привязка сотрудник ↔ вход, адресация уведомлений. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Zone.name, schema: ZoneSchema }, { name: ZoneAssignment.name, schema: ZoneAssignmentSchema }, { name: Handoff.name, schema: HandoffSchema }]), NotificationsModule],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
