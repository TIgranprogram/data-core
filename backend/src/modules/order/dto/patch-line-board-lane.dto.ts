import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { BoardLane } from '../order.schema';

/** TZ-COMBINE-403 — PATCH /orders/:id/lines/:lineId/lane */
export class PatchLineBoardLaneDto {
  @ApiProperty({
    enum: ['prep', 'design', 'shop', 'to_ship', 'shipped'],
    description:
      'Колонка Комбайна. `shipped` через PATCH запрещён — только POST /orders/:id/ship.',
  })
  @IsIn(['prep', 'design', 'shop', 'to_ship', 'shipped'])
  lane!: BoardLane;
}
