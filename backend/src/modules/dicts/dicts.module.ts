import { Module } from '@nestjs/common';
import { DictsController } from './dicts.controller';
import { DictsService } from './dicts.service';
import { AuditModule } from '../audit/audit.module';

@Module({ imports: [AuditModule], controllers: [DictsController], providers: [DictsService], exports: [DictsService] })
export class DictsModule {}
