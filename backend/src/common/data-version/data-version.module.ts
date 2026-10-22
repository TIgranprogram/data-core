import { Global, Module } from '@nestjs/common';
import { DataVersionService } from './data-version.service';

/** Версии данных и кэш тяжёлых списков (скорость С9) — доступен всем модулям. */
@Global()
@Module({ providers: [DataVersionService], exports: [DataVersionService] })
export class DataVersionModule {}
