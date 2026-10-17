import { ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsDateString, IsIn, IsOptional } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

/**
 * PATCH body for orders.
 *
 * Must NOT inherit CreateOrderDto.status `@IsIn(['draft','confirmed'])` —
 * that create-only constraint would reject legitimate board transitions
 * (in_production / ready) before OrderService.assertOrderStatusTransition
 * (TZ-OPS-315 regression / TZ-SWEEP-401).
 *
 * shipped / delivered / cancelled stay out of PATCH — use POST ship/cancel.
 */
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, ['status'] as const),
) {
  @ApiPropertyOptional({
    enum: ['draft', 'confirmed', 'in_production', 'ready'],
    description:
      'Операционный статус доски (TZ-SWEEP-401). shipped/delivered/cancelled — только через POST ship/cancel.',
  })
  @IsOptional()
  @IsIn(['draft', 'confirmed', 'in_production', 'ready'], {
    message:
      'Отгрузка — через действие «Отгрузить»; отмена — «Отменить заказ». Через PATCH допустимы только draft/confirmed/in_production/ready.',
  })
  status?: 'draft' | 'confirmed' | 'in_production' | 'ready';

  @ApiPropertyOptional({ description: 'Заказ оплачен' })
  @IsOptional() @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ description: 'Дата оплаты (ISO)' })
  @IsOptional() @IsDateString()
  paidAt?: string;
}
