import { Module } from '@nestjs/common';
import { FillAuditController } from './fill-audit.controller';
import { FillAuditService } from './fill-audit.service';

@Module({ controllers: [FillAuditController], providers: [FillAuditService] })
export class FillAuditModule {}
