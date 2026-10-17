import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ collection: 'roles', timestamps: true, softDelete: false })
export class Role {
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  @Prop({ required: true })
  label!: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  @Prop({ default: false })
  isSystem!: boolean;

  @Prop({ default: 100 })
  sortOrder!: number;

  @Prop({ type: [String], default: [] })
  sectionIds!: string[];

  /** TZ-ACCESS-301: page ACL — visible nav pages for this role. */
  @Prop({ type: [String], default: [] })
  pages!: string[];

  @Prop({ default: true })
  isActive!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
