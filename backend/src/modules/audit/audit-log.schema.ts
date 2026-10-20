import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ collection: 'auditlogs', timestamps: { createdAt: true, updatedAt: false }, softDelete: false })
export class AuditLog {
  @Prop({ required: true, index: true })
  action!: string;

  @Prop({ required: true, index: true })
  entityType!: string;

  @Prop({ type: Types.ObjectId, index: true })
  entityId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  userId?: Types.ObjectId;

  @Prop()
  userName?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };

  @Prop({ index: true })
  packageTag?: string;

  @Prop()
  ipAddress?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
