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

  /**
   * SK-8a: разделы «Рабочего места», которые видит роль (ид из
   * common/app-sections.ts). Нет поля / пусто — как раньше, по иерархии роли.
   * Без default: старые документы поле не получают.
   */
  @Prop({ type: [String], default: undefined })
  appSections?: string[];

  /**
   * SK-8c: своя роль — «права как у» встроенной (user|manager|accountant|director,
   * не admin). У встроенных и старых ролей поля нет. Права = права baseRole
   * (common/roles-hierarchy.ts), своя роль даёт только название и разделы меню.
   */
  @Prop({ type: String, default: undefined })
  baseRole?: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
