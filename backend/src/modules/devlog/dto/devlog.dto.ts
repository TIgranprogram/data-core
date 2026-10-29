import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { DOC_KINDS, ITEM_STATUSES, ITEM_TYPES } from '../devlog.schemas';

export class ImportCommitDto {
  @Matches(/^[0-9a-f]{7,40}$/) hash!: string;
  @IsISO8601() date!: string;
  @IsString() @MaxLength(500) subject!: string;
  /** Последняя строка тела коммита (эстафета 🏠/🏢). */
  @IsOptional() @IsString() @MaxLength(300) footer?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) paths?: string[];
  /** `v1.N`, если коммит входит в версию приложения. */
  @IsOptional() @Matches(/^v\d+\.\d+$/) releaseVersion?: string;
}

export class ImportItemDto {
  @Matches(/^(task|commit):[\w.-]{1,80}$/) key!: string;
  @IsIn(ITEM_TYPES as unknown as string[]) type!: string;
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(60) area?: string;
  @IsOptional() @IsIn(['open', 'done']) status?: string;
  @IsOptional() @IsString() @MaxLength(200) file?: string;
  @IsOptional() @IsISO8601() closedAt?: string;
}

export class ImportDocDto {
  @IsString() @MaxLength(300) path!: string;
  @IsString() @MaxLength(300) title!: string;
  @IsIn(DOC_KINDS as unknown as string[]) kind!: string;
  @IsString() @MaxLength(600_000) text!: string;
  @IsOptional() @IsISO8601() closedAt?: string;
}

/** Файлы набора для нового проекта: только роли, процессы, шаблоны (без deploy/, секретов, кода). */
export const KIT_PATH_RE =
  /^(\.claude\/agents\/[\w.-]+\.md|\.claude\/skills\/[\w.-]+\/SKILL\.md|docs\/roles\/(README|TZ-TEMPLATE)\.md|CLAUDE\.md|AGENTS\.md|docs\/(CANON|DESIGN)\.md)$/;

export class ImportKitDto {
  @Matches(KIT_PATH_RE) path!: string;
  @IsString() @MaxLength(200_000) text!: string;
}

/** Тело `POST /api/devlog/import` (≤ 1 МБ). */
export class ImportDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportCommitDto) commits?: ImportCommitDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportItemDto) items?: ImportItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ImportDocDto) docs?: ImportDocDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ImportKitDto) kit?: ImportKitDto[];
  /** Короткий хэш коммита, с которого снят набор. */
  @IsOptional() @Matches(/^[0-9a-f]{7,40}$/) kitVersion?: string;
  /** Скопировать группы из clienterrors (без stack). */
  @IsOptional() @IsBoolean() syncErrors?: boolean;
}

export class PatchSessionDto {
  /** null — снять ручную правку. */
  @IsOptional() @IsNumber() @Min(0) manualHours?: number | null;
}

export class PatchItemDto {
  @IsOptional() @IsIn(ITEM_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsNumber() @Min(0) hours?: number;
  @IsOptional() @IsString() @MaxLength(40) fixCommit?: string;
  @IsOptional() @Matches(/^(v\d+\.\d+|srv-[0-9a-f]+)$/) fixVersion?: string;
}
