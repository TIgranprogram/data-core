import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Idempotency,
  IdempotencySchema,
} from './idempotency-storage.schema';
import { IdempotencyStorageService } from './idempotency-storage.service';
import { IdempotencyMiddleware } from './idempotency.middleware';

/**
 * TZ-247 — Idempotency module wiring.
 *
 * Registers the Idempotency Mongoose schema and provides the storage
 * service + middleware for binding in `AppModule` and `main.ts`
 * respectively.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: Idempotency.name, schema: IdempotencySchema }])],
  providers: [IdempotencyStorageService, IdempotencyMiddleware],
  exports: [IdempotencyStorageService, IdempotencyMiddleware],
})
export class IdempotencyModule {}
