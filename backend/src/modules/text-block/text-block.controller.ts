import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { TextBlockService } from './text-block.service';
import { CreateTextBlockDto } from './dto/create-text-block.dto';
import { UpdateTextBlockDto } from './dto/update-text-block.dto';

/**
 * TZ-86 Phase A.1 — TextBlock controller.
 *
 * Routes: GET / (list, optionally filtered by categoryId/isActive),
 *  GET /:id, POST /, PATCH /:id, DELETE /:id. Audit hooks via @AuditAction
 *  which globally registers AuditInterceptor metadata for the action.
 *
 * TZ-DOC-323 — the `GET /api/text-blocks?category=...` query has been
 * removed. Use `categoryId` (system/uuid) instead. The body-level
 * `category` enum property is also gone (DTO + schema) — callers that
 * still send it get explicit 400 from `ValidationPipe.forbidNonWhitelisted`.
 */
@Controller('text-blocks')
export class TextBlockController {
  constructor(private readonly service: TextBlockService) {}

  @Get()
  list(
    @Query('isActive') isActive?: string,
    @Query('categoryId') categoryId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const filter: { isActive?: boolean; categoryId?: string } = {};
    if (categoryId) filter.categoryId = categoryId;
    if (typeof isActive === 'string') {
      if (isActive === 'true') filter.isActive = true;
      else if (isActive === 'false') filter.isActive = false;
    }
    if (activeOnly === 'true') filter.isActive = true;
    return this.service.findAll(filter);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'TextBlock' })
  create(
    @Body() dto: CreateTextBlockDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.create(dto, req?.user?.organizationId ?? null);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'TextBlock' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTextBlockDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.update(id, dto, req?.user?.organizationId ?? null);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'TextBlock' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
