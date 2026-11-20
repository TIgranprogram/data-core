import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
export class PassportSourceDto {
  @IsIn(['site', 'attachment']) mode!: 'site' | 'attachment';
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() contextToken!: string;
  @IsOptional() @IsMongoId() attachmentId?: string;
  @IsOptional() @IsBoolean() confirm?: boolean;
  @IsOptional() @IsInt() @Min(0) expectedAttachmentGeneration?: number;
}
export class PassportSourceTicketDto { @IsString() contextToken!: string; }
export class PassportCandidatesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
