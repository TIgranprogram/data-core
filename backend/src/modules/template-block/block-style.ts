import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { BLOCK_FONT_MENU, type BlockFontMenuItem } from './font.menu';

/** Fonts available to the document renderer via self-hosted @font-face. */
export const BLOCK_STYLE_FONT_FAMILIES = BLOCK_FONT_MENU;
export type BlockStyleFontFamily = BlockFontMenuItem;

/**
 * TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — block typography subschema.
 *
 * `block.style` is the single source of truth for font family, size, colour,
 * alignment and line-height. Inline `font-family`/`font-size`/`color` inside
 * the paragraph HTML are stripped on save (`block-content-sanitizer`), so the
 * block style has no inline competitor in the DB and screen/PDF stay in sync.
 *
 * Bold / italic / underline / links remain inline-only and are NOT modelled
 * here (otherwise we'd reintroduce a second source of truth).
 */
@Schema({ _id: false, timestamps: false })
export class BlockStyle {
  @Prop({ type: String, enum: BLOCK_STYLE_FONT_FAMILIES })
  fontFamily?: BlockStyleFontFamily;

  @Prop({ type: Number, min: 6, max: 96 })
  fontSizePt?: number;

  @Prop({ type: String, match: /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/ })
  color?: string;

  @Prop({ type: String, enum: ['left', 'center', 'right', 'justify'] })
  align?: 'left' | 'center' | 'right' | 'justify';

  @Prop({ type: Number, min: 0.8, max: 3 })
  lineHeight?: number;
}

export const BlockStyleSchema = SchemaFactory.createForClass(BlockStyle);

/** Block style DTO — reference by create/update block DTOs (forbidNonWhitelisted). */
export class BlockStyleDto {
  @IsOptional() @IsString() @IsIn(BLOCK_STYLE_FONT_FAMILIES)
  fontFamily?: BlockStyleFontFamily;

  // fontSizePt is an integer points value (TZ: «целое, 6..96»).
  @IsOptional() @IsInt() @Min(6) @Max(96)
  fontSizePt?: number;

  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/)
  color?: string;

  @IsOptional() @IsIn(['left', 'center', 'right', 'justify'])
  align?: 'left' | 'center' | 'right' | 'justify';

  @IsOptional() @IsNumber() @Min(0.8) @Max(3)
  lineHeight?: number;
}