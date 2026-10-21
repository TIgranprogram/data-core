import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RateLimitEntry, RateLimitEntrySchema } from './rate-limit.schema';
import { RateLimitService } from './rate-limit.service';
import { RateLimitController } from './rate-limit.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: RateLimitEntry.name, schema: RateLimitEntrySchema }])],
  controllers: [RateLimitController],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
