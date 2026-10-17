import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class OrderItemDto {
  @ApiProperty({ description: 'ID продукта' })
  @IsObjectId()
  productId!: string;

  @ApiPropertyOptional({ description: 'Название продукта' })
  @IsOptional() @IsString() productName?: string;
  @ApiPropertyOptional({ description: 'Артикул продукта' })
  @IsOptional() @IsString() productSku?: string;

  @ApiProperty({ description: 'Количество' })
  @IsNumber() @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Единица измерения' })
  @IsOptional() @IsString() unit?: string;

  @ApiPropertyOptional({
    description:
      'Цена за единицу. OPTIONAL с TZ-ORDERS-301: заказы из принятых КП приходят ' +
      'strip-commerce (без цены) — цена/сумма в заказе не хранятся.',
  })
  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Ответственный за изделие (User id)' })
  @IsOptional() @IsObjectId()
  ownerUserId?: string;

  @ApiPropertyOptional({ description: 'Плановая дата отгрузки позиции (ISO date)' })
  @IsOptional() @IsDateString()
  plannedShipDate?: string;


  @ApiPropertyOptional({ description: 'Готово к работе на уровне линии' })
  @IsOptional() @IsBoolean()
  readyForWork?: boolean;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Номер заказа' })
  @IsOptional() @IsString() number?: string;

  @ApiProperty({ description: 'ID контрагента (заказчик)' })
  @IsObjectId()
  counterpartyId!: string;

  @ApiProperty({ description: 'ID площадки/объекта (Site)' })
  @IsObjectId()
  siteId!: string;

  @ApiPropertyOptional({ description: 'ID коммерческого предложения' })
  @IsOptional() @IsObjectId() quotationId?: string;
  @ApiPropertyOptional({ description: 'ID контракта' })
  @IsOptional() @IsObjectId() contractId?: string;

  @ApiPropertyOptional({ description: 'Дата заказа (ISO)' })
  @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Плановая дата (ISO)' })
  @IsOptional() @IsDateString() plannedDate?: string;

  @ApiPropertyOptional({
    enum: ['draft', 'confirmed'],
    description:
      'Статус при создании: только draft/confirmed (TZ-OPS-315). shipped/delivered/cancelled '
      + 'достижимы только через POST /orders/:id/ship|/cancel; in_production/ready — через PATCH.',
  })
  @IsOptional()
  @IsIn(['draft', 'confirmed'], {
    message:
      'Заказ нельзя создать сразу в статусе shipped/delivered/cancelled/in_production/ready — отгрузка через «Отгрузить», отмена через «Отменить», остальное через PATCH',
  })
  status?: 'draft' | 'confirmed';

  @ApiPropertyOptional({ description: 'Заказ оплачен' })
  @IsOptional() @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ description: 'Дата оплаты (ISO)' })
  @IsOptional() @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Заметки к заказу' })
  @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ enum: ['own', 'customer'], description: 'Источник материалов' })
  @IsOptional() @IsIn(['own', 'customer'])
  materialsSource?: 'own' | 'customer';

  @ApiPropertyOptional({
    enum: ['manual', 'desktop-import'],
    description:
      'Провенанс заказа (TZD-ORDER-IMPORT-01). Default manual. mutation-journal ' +
      'order.create всегда форсит desktop-import — этот вход не даёт вызывающему через ' +
      'REST выдать чужой заказ за импорт.',
  })
  @IsOptional() @IsIn(['manual', 'desktop-import'])
  source?: 'manual' | 'desktop-import';
  @ApiPropertyOptional({ description: 'Адрес доставки' })
  @IsOptional() @IsString() deliveryAddress?: string;
  @ApiPropertyOptional({ description: 'ID менеджера' })
  @IsOptional() @IsObjectId() managerId?: string;

  @ApiPropertyOptional({
    enum: ['low', 'normal', 'high', 'urgent'],
    description: 'Приоритет заказа',
  })
  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @ApiPropertyOptional({ description: 'ID организации-исполнителя (наша фирма)' })
  @IsOptional() @IsObjectId()
  organizationId?: string;

  @ApiProperty({ type: [OrderItemDto], description: 'Позиции заказа' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
