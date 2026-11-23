import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, Equals, IsArray, IsIn, ValidateBy, ValidateIf } from 'class-validator';
import { CreateRoleDto } from './create-role.dto';
import { STOCK_VIEWS, type StockView } from '../../../common/stock-views';

// PartialType пропускает null. Для нового списка null не должен означать наследование прав.
export class UpdateRoleDto extends PartialType(OmitType(CreateRoleDto, ['stockViews'] as const)) {
  @ApiPropertyOptional({ type: Boolean, allOf: [{ type: 'boolean', enum: [true] }], description: 'Удалить явную настройку экранов и наследовать базовую роль; нельзя одновременно со stockViews' })
  @ValidateIf((_object, value) => value !== undefined)
  @Equals(true, { message: 'Сброс экранов допускает только true' })
  @ValidateBy({ name: 'stockViewsResetExclusive', validator: {
    validate: (_value, args) => (args?.object as UpdateRoleDto).stockViews === undefined,
    defaultMessage: () => 'Нельзя одновременно задать и сбросить экраны склада',
  } })
  resetStockViews?: true;

  @ApiPropertyOptional({ type: [String], enum: STOCK_VIEWS, description: 'Дополнительные экраны склада для просмотра: нет — без изменения, [] — отключены; права API не меняются' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: 'Экраны склада — список' })
  @ArrayMaxSize(2, { message: 'Дополнительных экранов склада не больше двух' })
  @ArrayUnique({ message: 'Экран склада указан дважды' })
  @IsIn(STOCK_VIEWS, { each: true, message: 'Доступны экраны pipe и sheet' })
  stockViews?: StockView[];
}
