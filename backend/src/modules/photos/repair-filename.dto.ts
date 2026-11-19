import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
/** Только исправление известной кодировки; пути и произвольное переименование запрещены. */
export class RepairOriginalFilenameDto {
  @ApiProperty() @IsString() @Length(1, 255) @Matches(/^[^\\/\x00-\x1f\x7f]+$/) expectedOriginalFilename!: string;
  @ApiProperty() @IsString() @Length(1, 255) @Matches(/^[^\\/\x00-\x1f\x7f]+$/) newOriginalFilename!: string;
}
export function isFilenameEncodingRepair(old: string, next: string): boolean {
  if (!old || !next || old === next || /[^\u0000-\u00ff]/u.test(old)) return false;
  const bytes = Buffer.from(old, 'latin1');
  return ['utf-8', 'windows-1251'].some(encoding => {
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) === next; } catch { return false; }
  });
}
