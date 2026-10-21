import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductModulePhotoDocument = HydratedDocument<ProductModulePhoto>;

/**
 * TZ-83 Фаза A.7: ProductModulePhoto entity.
 * Аналог ProductPhoto для productmodules — управляет фотогалереей модуля.
 *
 * Ключевые правила:
 *  - Один из `photoId` ИЛИ `url` обязан быть заполнен (validator ниже)
 *  - Только одно фото в module может быть `isMain: true` (атомарность через Service.setMain)
 */
@Schema({ collection: 'productmodulephotos', timestamps: true })
export class ProductModulePhoto {
  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: true, index: true })
  productModuleId!: Types.ObjectId;

  /** Опциональная ссылка на общую сущность Photo (если фото уже в каталоге). */
  @Prop({ type: Types.ObjectId, ref: 'Photo' })
  photoId?: Types.ObjectId;

  /** Опциональный прямой URL (для случая без общей Photo entity, например CDN). */
  @Prop()
  url?: string;

  @Prop()
  caption?: string;

  @Prop({ default: false, index: true })
  isMain!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ProductModulePhotoSchema = SchemaFactory.createForClass(ProductModulePhoto);
ProductModulePhotoSchema.index({ productModuleId: 1, sortOrder: 1 });

/**
 * TZ-83 Фаза A.7: schema-level validator.
 * Гарантирует что в БД не окажется "пустое" фото без источника.
 * pre-save hook выбрасывает clear error при попытке сохранить broken record.
 */
ProductModulePhotoSchema.pre('save', function (next) {
  const doc = this as ProductModulePhotoDocument;
  if (!doc.photoId && !doc.url) {
    return next(
      new Error('ProductModulePhoto requires EITHER photoId OR url — одно из полей обязательно'),
    );
  }
  return next();
});
