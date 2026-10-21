import { Module } from '@nestjs/common';
import { DictsController } from './dicts.controller';
import { DictsService } from './dicts.service';

@Module({ controllers: [DictsController], providers: [DictsService], exports: [DictsService] })
export class DictsModule {}
