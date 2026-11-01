import { IsBoolean, IsIn, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { PASSPORT_IMAGE_KINDS } from '../product-passport/product-passport.schema';
import { PHOTO_PURPOSES } from './product-photo-purpose';

/** POST /products/:productId/photos — только перечисленные поля (forbidNonWhitelisted). */
export class AttachProductPhotoDto {
  @IsOptional() @IsMongoId() photoId?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsBoolean() isMain?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
  /** showcase (по умолчанию) | passport | drawing. */
  @IsOptional() @IsIn(PHOTO_PURPOSES as unknown as string[]) purpose?: string;
  /** Вид рисунка паспорта — только при purpose='passport'. */
  @IsOptional() @IsIn(PASSPORT_IMAGE_KINDS as unknown as string[]) kind?: string;
}

/** PATCH /products/:productId/photos/:id. */
export class UpdateProductPhotoDto {
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsBoolean() isMain?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
  @IsOptional() @IsIn(PASSPORT_IMAGE_KINDS as unknown as string[]) kind?: string;
}
