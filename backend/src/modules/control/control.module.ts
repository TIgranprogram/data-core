import { Module } from '@nestjs/common';
import { DiskModule } from '../disk/disk.controller';
import { FillAuditModule } from '../fill-audit/fill-audit.module';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';

@Module({
  imports: [FillAuditModule, DiskModule],
  controllers: [ControlController],
  providers: [ControlService],
})
export class ControlModule {}
