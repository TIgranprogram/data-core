import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RateLimitEntry, RateLimitEntryDocument } from './rate-limit.schema';

@Injectable()
export class RateLimitService {
  constructor(
    @InjectModel(RateLimitEntry.name)
    private readonly model: Model<RateLimitEntryDocument>,
  ) {}

  async findAll(): Promise<RateLimitEntryDocument[]> {
    return this.model.find().sort({ expiresAt: -1 }).limit(100).exec();
  }

  async clear(key: string): Promise<{ deleted: boolean }> {
    if (!key) return { deleted: false };
    const result = await this.model.deleteOne({ key }).exec();
    return { deleted: result.deletedCount > 0 };
  }

  async clearAll(): Promise<{ deletedCount: number }> {
    const result = await this.model.deleteMany({}).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }

  async increment(key: string, ttlMs: number): Promise<{ count: number }> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const doc = await this.model.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $set: { expiresAt } },
      { upsert: true, new: true },
    );
    return { count: doc.count };
  }
}
