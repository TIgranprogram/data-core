import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsMongoId, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { renderRegistryPdf } from './passport-registry-pdf';
import { PassportRegistryService } from './passport-registry.service';

const WORK = ['admin', 'director', 'manager'] as const;

class PassportHandoverDto {
  @ApiProperty() @IsUUID() clientUid!: string;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
  @ApiPropertyOptional({ type: [String], description: 'Готовые позиции этой ведомости. Без списка требуется готовность всего комплекта.' })
  @ValidateIf((_dto, value) => value !== undefined) @IsArray() @ArrayNotEmpty()
  @ArrayUnique((id: unknown) => typeof id === 'string' ? id.toLowerCase() : id) @IsMongoId({ each: true })
  incomeIds?: string[];
  @ApiProperty() @IsString() @Length(1, 160) recipient!: string;
  @ApiProperty({ example: '2026-11-22' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) handedOn!: string;
}

@ApiTags('Паспорта изделий')
@AppSection('passports')
@Roles(...WORK)
@Controller('passports/registry')
export class PassportRegistryController {
  constructor(private readonly registry: PassportRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'Заказы с паспортами: реестры, рабочая очередь и история передач' })
  @ApiQuery({ name: 'state', required: false, enum: ['work', 'handover', 'history'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(@Query() query: Record<string, string>) {
    return this.registry.list(query);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Реестр паспортов договора, ожидаемые позиции и история передач' })
  one(@Param('orderId') orderId: string) {
    return this.registry.get(orderId);
  }

  @Get(':orderId/pdf')
  @ApiOperation({ summary: 'Печатный реестр паспортов, включая ещё не выпущенные позиции' })
  async pdf(@Param('orderId') orderId: string, @Res({ passthrough: true }) res: Response) {
    const record = await this.registry.get(orderId);
    const buffer = await renderRegistryPdf(record);
    const suffix = String(record.productionNo || record.orderNo || orderId).replace(/[\r\n/\\]/g, '-');
    const file = encodeURIComponent('Реестр паспортов ' + suffix + '.pdf');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename=\"passport-registry.pdf\"; filename*=UTF-8''" + file });
    return new StreamableFile(buffer);
  }

  @Post(':orderId/handover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Записать ведомость передачи выбранных готовых паспортов заказчику' })
  @AuditAction({ action: 'passport.handover', entityType: 'SalesOrder', idParam: 'orderId' })
  handover(@Param('orderId') orderId: string, @Body() dto: PassportHandoverDto, @CurrentUser() user: AuthenticatedUser) {
    if (user.keyScope) throw new ForbiddenException('Подтвердите передачу под личной учётной записью');
    return this.registry.handover(orderId, dto, user.id, user.username);
  }
}
