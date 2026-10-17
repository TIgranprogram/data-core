import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleOrgDocument = HydratedDocument<RoleOrg>;

@Schema({ collection: 'orgroles', timestamps: true, softDelete: false })
export class RoleOrg {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: false })
  isSystem!: boolean;
}

export const RoleOrgSchema = SchemaFactory.createForClass(RoleOrg);
