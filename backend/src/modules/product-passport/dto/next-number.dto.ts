import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** ПН: № паспорта, который получит следующий выпущенный паспорт. */
export class NextPassportNumberDto {
  @ApiProperty({ minimum: 1, maximum: 999999999 }) @IsInt() @Min(1) @Max(999999999) next!: number;
}
