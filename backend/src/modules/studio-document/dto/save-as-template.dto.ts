import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** TZ-DOC-STUDIO-1501 — save studio document as DocumentTemplate. */
export class SaveAsTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** When false (default), strip dataBinding and field anchor refs from blocks. */
  @IsOptional()
  @IsBoolean()
  keepDataBindings?: boolean;
}
