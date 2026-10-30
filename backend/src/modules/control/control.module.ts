import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClientErrorsModule } from '../client-errors/client-errors.module';
import { DictsModule } from '../dicts/dicts.module';
import { DiskModule } from '../disk/disk.controller';
import { FillAuditModule } from '../fill-audit/fill-audit.module';
import { PartnersModule } from '../partners/partners.module';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';
import { QuestionsController } from './questions/questions.controller';
import { QuestionsService } from './questions/questions.service';

@Module({
  imports: [FillAuditModule, DiskModule, AuditModule, ClientErrorsModule, DictsModule, PartnersModule],
  controllers: [ControlController, QuestionsController],
  providers: [ControlService, QuestionsService],
})
export class ControlModule {}
