import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AddSheetSourceDto {
  @ApiProperty({ description: 'Ссылка на Google-таблицу (https://docs.google.com/spreadsheets/d/…) или её ID' })
  @IsString()
  @Length(20, 500)
  url!: string;
}
