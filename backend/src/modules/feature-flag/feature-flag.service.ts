import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeatureFlag, FeatureFlagDocument } from './feature-flag.schema';

type FlagSettings = Pick<FeatureFlag, 'label' | 'description' | 'enabledByDefault' | 'category' | 'isActive'>;

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(
    @InjectModel(FeatureFlag.name)
    private readonly model: Model<FeatureFlagDocument>,
  ) {}

  async findAll(): Promise<FeatureFlagDocument[]> {
    return this.model.find().sort({ category: 1, key: 1 }).exec();
  }

  async findByKey(key: string): Promise<FeatureFlagDocument> {
    const doc = await this.model.findOne({ key }).exec();
    if (!doc) throw new NotFoundException(`FeatureFlag "${key}" not found`);
    return doc;
  }

  async upsert(
    key: string,
    data: Partial<FlagSettings>,
  ): Promise<FeatureFlagDocument> {
    const doc = await this.model
      .findOneAndUpdate({ key }, { $set: data }, { new: true, upsert: true, setDefaultsOnInsert: true })
      .exec();
    this.logger.log(`FeatureFlag "${key}" updated`);
    return doc as FeatureFlagDocument;
  }

  async seedDefault(key: string, data: FlagSettings): Promise<boolean> {
    const now = new Date();
    // Глобальный audit hook добавляет updatedAt при каждом Mongoose update.
    const result = await this.model.collection.updateOne(
      { key },
      { $setOnInsert: { ...data, deletedAt: null, createdAt: now, updatedAt: now } },
      { upsert: true },
    );
    return result.upsertedCount === 1;
  }

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.model.findOne({ key }).lean().exec();
    if (!flag) return false;
    return flag.isActive && flag.enabledByDefault;
  }
}
