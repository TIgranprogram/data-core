import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { BoardLane } from '../order.schema';

/** TZ-COMBINE-406 — PATCH /orders/:id/lines/:lineId/modules/:moduleId/lane */
export class PatchModuleLaneDto {
  @ApiProperty({
    enum: ['prep', 'design', 'shop', 'to_ship', 'shipped'],
    description:
      'Колонка Комбайна для модуля изделия. `shipped` через PATCH запрещён — только POST /orders/:id/ship.',
  })
  @IsIn(['prep', 'design', 'shop', 'to_ship', 'shipped'])
  lane!: BoardLane;
}
