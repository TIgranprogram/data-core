import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { STOCK_VIEWS, type StockView } from '../../common/stock-views';

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

  /** Дополнительные экраны склада: нет — по базовой роли, [] — отключены. Не меняет права API. */
  @Prop({ type: [String], enum: STOCK_VIEWS, default: undefined })
  stockViews?: StockView[];

  /** СМ.4: категории склада (categories.id, тип material), которые видит и меняет роль; пусто — весь склад. */
  @Prop({ type: [String], default: undefined })
  stockCategoryIds?: string[];

  /** Склады (stockzones.id), которые видит и меняет роль; объединение. Пусто — весь склад (или запасной путь stockCategoryIds). */
  @Prop({ type: [String], default: undefined })
  warehouseIds?: string[];

  /**
   * SK-8c: своя роль — «права как у» встроенной (user|manager|accountant|director,
   * не admin). У встроенных и старых ролей поля нет. Права = права baseRole
   * (common/roles-hierarchy.ts), своя роль даёт только название и разделы меню.
   */
  @Prop({ type: String, default: undefined })
  baseRole?: string;

  /** Галочка «Деньги» (2026-11-01): false — не видит цены/суммы/оплату; нет поля — по иерархии. Без default. */
  @Prop({ type: Boolean, default: undefined })
  money?: boolean;

  /** Пакетная заявка из каталога. Отсутствующее значение наследуется от базовой роли. */
  @Prop({ type: Boolean, default: undefined })
  requestCartCreate?: boolean | null;

  @Prop({ default: true })
  isActive!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
