import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Idempotency,
  IdempotencySchema,
} from './idempotency-storage.schema';
import { IdempotencyStorageService } from './idempotency-storage.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Idempotency.name, schema: IdempotencySchema }])],
  providers: [IdempotencyStorageService],
  exports: [IdempotencyStorageService],
})
export class IdempotencyModule {}
