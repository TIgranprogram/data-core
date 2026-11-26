import { IsNumber, IsUUID, Min } from 'class-validator';

/** Узкое намерение закупки: реквизиты позиции и заявки задаёт сервер. */
export class SupplyStockRequestDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(Number.MIN_VALUE)
  qty!: number;

  @IsUUID('4')
  clientUid!: string;
}

/** У этого POST нет публичных query-параметров. */
export class SupplyStockRequestQueryDto {}
