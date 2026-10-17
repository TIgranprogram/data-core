import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PERMISSIONS } from '../../common/seed/permissions.constants';
import { Permission, PermissionDocument } from './permission.schema';

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectModel(Permission.name)
    private readonly model: Model<PermissionDocument>,
  ) {}

  /**
   * Idempotent seed: bulk upsert all canonical permissions on first start.
   * Safe to call on every boot — only writes changed fields.
   */
  async onModuleInit(): Promise<void> {
    const ops = PERMISSIONS.map((p) => ({
      updateOne: {
        filter: { key: p.key },
        update: { $set: { ...p } },
        upsert: true,
      },
    }));
    const result = await this.model.bulkWrite(ops);
    this.logger.log(
      `Permissions seeded: ${result.upsertedCount} inserted, ${result.modifiedCount} updated`,
    );
  }

  async getByKey(key: string): Promise<PermissionDocument | null> {
    return this.model.findOne({ key }).exec();
  }

  async getBySection(section: string): Promise<PermissionDocument[]> {
    return this.model.find({ section }).exec();
  }

  async getAll(): Promise<PermissionDocument[]> {
    return this.model.find().sort({ section: 1, action: 1 }).exec();
  }

  async getAllKeys(): Promise<string[]> {
    const docs = await this.model.find().select('key').lean().exec();
    return docs.map((d) => d.key);
  }
}
