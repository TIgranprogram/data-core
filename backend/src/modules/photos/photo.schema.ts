import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PhotoDocument = HydratedDocument<Photo>;
export type PhotoVariant = 'original' | 'full' | 'medium' | 'thumb';
export type PhotoFrameFit = 'contain' | 'cover';

/**
 * Прямоугольный кадр показа фото (WAVE-PHOTO-FRAME-POSITION, TZ-PHOTO-304).
 * v1 — тонкий: CSS `object-fit` + `object-position` проценты, без ре-энкода.
 * Default без meta: `{ fit: 'contain', posX: 50, posY: 50 }`.
 */
export interface PhotoFrame {
  fit: PhotoFrameFit;
  /** 0..100, CSS object-position % (горизонталь). */
  posX: number;
  /** 0..100, CSS object-position % (вертикаль). */
  posY: number;
}

@Schema({ collection: 'photos', timestamps: true })
export class Photo {
  @Prop({ required: true })
  storageUrl!: string;

  @Prop()
  originalFilename?: string;

  @Prop({ required: true, enum: ['original', 'full', 'medium', 'thumb'], default: 'original', index: true })
  variant!: PhotoVariant;

  @Prop()
  mimeType?: string;

  @Prop()
  sizeBytes?: number;

  @Prop()
  widthPx?: number;

  @Prop()
  heightPx?: number;

  @Prop({ type: Types.ObjectId, ref: 'Photo' })
  parentPhotoId?: Types.ObjectId;

  /** Optional: link to a Photo where this is a variant. */
  @Prop({ type: Types.ObjectId, ref: 'Photo' })
  linkedPhotoId?: Types.ObjectId;

  @Prop()
  alt?: string;

  /** Прямоугольный кадр показа (TZ-PHOTO-304). Отсутствует = contain/center. */
  @Prop({ type: () => Object, default: () => ({ fit: 'contain', posX: 50, posY: 50 }) })
  frame?: PhotoFrame;

  /**
   * Multipart uploads persist the original and a separate `thumb` child;
   * JSON registration remains available for pre-uploaded external URLs.
   */

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const PhotoSchema = SchemaFactory.createForClass(Photo);
