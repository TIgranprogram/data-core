import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import type { DeskNoteKind } from '../desk-note.schema';

export class CreateDeskNoteDto {
  @IsString()
  @Length(1, 4000)
  text!: string;

  @IsOptional()
  @IsIn(['note', 'checklist', 'reminder'])
  kind?: DeskNoteKind;

  @IsObjectId()
  anchorOrderId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  anchorLineId?: string;

  @IsOptional()
  @IsObjectId()
  anchorModuleId?: string;
}

export class UpdateDeskNoteDto {
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  text?: string;

  @IsOptional()
  @IsIn(['note', 'checklist', 'reminder'])
  kind?: DeskNoteKind;

  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}
