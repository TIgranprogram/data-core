import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { BlockStyleDto } from '../block-style';

/**
 * TZ-104.6 carry-over DTO — multi-column TipTap cell on a TemplateBlock.
 * Shape mirrors `backend TextBlockColumn` only on the strict subset the
 * document generator + builder canvas actually consume: `id`, `content`,
 * `width` (0..1 normalized). Mirrors `frontend TextBlockColumn` in
 * `frontend/src/app/shared/services/pi-text-blocks.service.ts`.
 */
export class TemplateBlockColumnDto {
  @IsString() @IsNotEmpty()
  id!: string;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsNumber() @Min(0)
  width?: number;

  @IsOptional() @IsNumber() @Min(1)
  fontSize?: number;
}

export class DataBindingDto {
  @IsIn([
    'organization',
    'counterparty',
    'product',
    'material',
    'work-type',
    'order',
    'contract',
    'quotation',
    'invoice',
    'cost-calculation',
    'static',
  ])
  source!:
    | 'organization'
    | 'counterparty'
    | 'product'
    | 'material'
    | 'work-type'
    | 'order'
    | 'contract'
    | 'quotation'
    | 'invoice'
    | 'cost-calculation'
    | 'static';

  @IsOptional() @IsString()
  field?: string;

  @IsOptional() @IsString()
  value?: string;

  @IsOptional()
  @IsIn(['text', 'date', 'currency', 'number'])
  format?: 'text' | 'date' | 'currency' | 'number';
}

/**
 * ORDERING CONSTRAINT: classes referenced by decorators (@Type/@ValidateNested)
 * MUST be declared before their consumer — emitDecoratorMetadata evaluates
 * `Reflect.metadata('design:type', X)` at class-definition time, so a forward
 * reference throws `Cannot access X before initialization` at boot. Do not
 * move BlockLayoutDto / BlockSourceDto below CreateTemplateBlockDto.
 */
export class BlockLayoutDto {
  /** Pagination is not implemented yet; reject page 2+ instead of silently remapping it. */
  @IsOptional() @IsNumber() @Min(1) @Max(1)
  page?: number;

  @IsOptional() @IsNumber() @Min(0)
  x?: number;

  @IsOptional() @IsNumber() @Min(0)
  y?: number;

  @IsOptional() @IsNumber() @Min(0)
  width?: number;

  @IsOptional() @IsNumber() @Min(0)
  height?: number;

  @IsOptional() @IsNumber() @Min(0)
  zIndex?: number;

  @IsOptional() @IsNumber()
  rotation?: number;
}

export class BlockSourceDto {
  @IsIn(['text-block', 'table-template', 'field', 'literal'])
  kind!: 'text-block' | 'table-template' | 'field' | 'literal';

  @IsOptional() @IsString() @IsNotEmpty() @IsObjectId()
  refId?: string;

  @IsOptional() @IsIn(['live', 'snapshot'])
  mode?: 'live' | 'snapshot';

  @IsOptional() @IsIn([
    'organization',
    'counterparty',
    'product',
    'material',
    'work-type',
    'order',
    'contract',
    'quotation',
    'invoice',
    'cost-calculation',
  ])
  source?: Exclude<DataBindingDto['source'], 'static'>;

  @IsOptional() @IsString() @IsNotEmpty()
  field?: string;

  @IsOptional() @IsIn(['text', 'date', 'currency', 'number'])
  format?: 'text' | 'date' | 'currency' | 'number';

  @IsOptional() @IsString()
  value?: string;
}

export class CreateTemplateBlockDto {
  @IsObjectId() templateId!: string;

  /** TZ-DOC-STUDIO-201a — optional polymorphic parent; legacy builder omits these. */
  @IsOptional()
  @IsIn(['template', 'studio-document'])
  parentType?: 'template' | 'studio-document';

  @IsOptional()
  @IsObjectId()
  parentId?: string;

  @IsIn(['header', 'text', 'table', 'image', 'signature', 'spacer'])
  type!: 'header' | 'text' | 'table' | 'image' | 'signature' | 'spacer';

  @IsNumber() @Min(0)
  order!: number;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BlockStyleDto)
  style?: BlockStyleDto;

  /**
   * TZ-104.6 carry-over — multi-column text-block payload. Optional;
   * builder canvas renders `columns[]` as a CSS grid when length > 1.
   * Stored verbatim via `Mongoose` schema; `@ValidateNested` enforces
   * that any nested cell matches `TemplateBlockColumnDto`. Empty array
   * ⇒ fall back to flat `content` rendering.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateBlockColumnDto)
  columns?: TemplateBlockColumnDto[];

  @IsOptional() @IsNumber() @Min(0) height?: number;
  @IsOptional() @IsBoolean() showLine?: boolean;
  @IsOptional() settings?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => DataBindingDto)
  dataBinding?: DataBindingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BlockLayoutDto)
  layout?: BlockLayoutDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BlockSourceDto)
  source?: BlockSourceDto;

  /** Persistent flat group id; null clears membership. */
  @IsOptional()
  @IsString()
  groupId?: string | null;

  /** Geometry lock — blocks move/resize/delete on the canvas. */
  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * Concrete body DTO for `POST /document-templates/:id/blocks`.
 *
 * MUST be a real class (via `OmitType`) rather than a TS mapped
 * `Omit<CreateTemplateBlockDto,'templateId'>`: the latter erases to `Object`
 * at runtime, so Nest's `ValidationPipe` would not reach `@ValidateNested`
 * nested DTOs (e.g. `style`) and bad values would fall through to Mongoose
 * as a 500 instead of the intended 400. `templateId` comes from the route
 * param, so it is omitted here (server-side).
 */
export class CreateTemplateBlockOnTemplateDto extends OmitType(
  CreateTemplateBlockDto,
  ['templateId'] as const,
) {}

