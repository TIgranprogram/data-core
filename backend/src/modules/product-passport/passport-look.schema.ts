import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PassportLookDocument = HydratedDocument<PassportLook>;

/**
 * Вид паспорта нашей фирмы (C076). Своя коллекция, CRM её не читает.
 * Нет записи или нет картинок — PDF как раньше. Выданные паспорта сами не перепечатываются:
 * бланк читается только в момент ручной печати, свой файл номера не трогаем.
 */
@Schema({ collection: 'passportlooks', timestamps: true, softDelete: false })
export class PassportLook {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  companyId!: Types.ObjectId;

  /** #RRGGBB. Пусто — линии чёрные. Без фона цвет в PDF не попадает. */
  @Prop({ type: String, default: null })
  color?: string | null;

  /** Фон обложки, `/uploads/passport-look/<файл>`. */
  @Prop({ type: String, default: null })
  coverFile?: string | null;

  /** Фон обычных страниц (включая талон). */
  @Prop({ type: String, default: null })
  pageFile?: string | null;

  /** Отступы текста от краёв бланка, мм. null — поле как у паспорта без бланка. */
  @Prop({ type: Number, default: null }) coverTop?: number | null;
  @Prop({ type: Number, default: null }) coverRight?: number | null;
  @Prop({ type: Number, default: null }) coverBottom?: number | null;
  @Prop({ type: Number, default: null }) coverLeft?: number | null;
  @Prop({ type: Number, default: null }) pageTop?: number | null;
  @Prop({ type: Number, default: null }) pageRight?: number | null;
  @Prop({ type: Number, default: null }) pageBottom?: number | null;
  @Prop({ type: Number, default: null }) pageLeft?: number | null;
}

export const PassportLookSchema = SchemaFactory.createForClass(PassportLook);
