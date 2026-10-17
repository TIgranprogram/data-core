import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/**
 * TZ-WORKERS-301 — Create DTO for the unified People entity (Worker).
 *
 * Whitelist-only: the global ValidationPipe strips unknown fields
 * (forbidNonWhitelisted → 400). `organizationId` is NOT accepted from the
 * client — it is derived from the authenticated user in the controller
 * (IDOR guard, TZ-238/315 pattern), so a user can never create a worker
 * in a foreign org scope.
 *
 * FK-поля (workTypeIds, supplierId, managerOfSupplierIds, userId,
 * personId) валидируются как ObjectId; битые ссылки дают 404 на уровне
 * service (soft-validation), не на уровне DTO.
 */
export class CreateWorkerDto {
  @ApiProperty({ example: 'Иванов' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: 'Иван' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiPropertyOptional({ example: 'Иванович' })
  @IsOptional() @IsString() patronymic?: string;

  @ApiPropertyOptional({ example: '5-й разряд' })
  @IsOptional() @IsString() grade?: string;

  @ApiPropertyOptional({ example: '+7 (900) 123-45-67' })
  @IsOptional() @IsString() phone?: string;

  @ApiPropertyOptional({ example: 'Цех сборки' })
  @IsOptional() @IsString() department?: string;

  @ApiPropertyOptional({ description: 'Почасовая ставка' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ratePerHour?: number;

  @ApiPropertyOptional({ type: [String], description: 'Ссылки на виды работ (M2M)' })
  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  workTypeIds?: string[];

  @ApiPropertyOptional({ description: 'Активен ли человек' })
  @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ description: 'Обратная совместимость: ссылка на Person' })
  @IsOptional() @IsObjectId() personId?: string;

  // ── TZ-WORKERS-301: новые поля «Людей» ──────────────────────────

  @ApiPropertyOptional({ example: 'ivan@example.com', description: 'Email (нижний регистр)' })
  @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional({ example: 'Менеджер по закупкам', description: 'Должность' })
  @IsOptional() @IsString() position?: string;

  @ApiPropertyOptional({ description: 'Фирма-поставщик, к которой привязан человек' })
  @IsOptional() @IsObjectId() supplierId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Фирмы-поставщики, где человек — менеджер' })
  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  managerOfSupplierIds?: string[];

  @ApiPropertyOptional({ description: 'Ссылка на аккаунт системы (User)' })
  @IsOptional() @IsObjectId() userId?: string;

  @ApiPropertyOptional({ description: 'Заметки' })
  @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ description: 'Системная запись' })
  @IsOptional() @IsBoolean() isSystem?: boolean;
}
