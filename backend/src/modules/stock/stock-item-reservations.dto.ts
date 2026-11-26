import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Пустое значение не превращаем в 0, отсутствующее сохраняет default. */
const pageNumber = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class StockItemReservationsDto {
  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(pageNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
