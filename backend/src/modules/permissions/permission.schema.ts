import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionDocument = HydratedDocument<Permission>;

export type PermissionAction = 'read' | 'write' | 'admin';

@Schema({ collection: 'permissions', timestamps: true, softDelete: false })
export class Permission {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ required: true, index: true })
  section!: string;

  @Prop({ required: true, enum: ['read', 'write', 'admin'] })
  action!: PermissionAction;

  @Prop()
  description?: string;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);
