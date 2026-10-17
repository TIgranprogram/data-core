import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { GeneratedDocumentService } from './generated-document.service';
import { BuildDocumentDto } from '../document-template/dto/build-document.dto';
import { IsOptional, IsString } from 'class-validator';

import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';
class GenerateDocumentOptionsDto extends BuildDocumentDto {
  @IsOptional() @IsString()
  name?: string;
}

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('generated-documents')
export class GeneratedDocumentController {
  constructor(private readonly service: GeneratedDocumentService) {}

  @Get()
  findAll(
    @Query('templateId') templateId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll({ templateId, sourceType, sourceId }, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.findById(id, user);
  }

  @Get(':id/html')
  async html(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    const doc = await this.service.findById(id, user);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(doc.html);
  }

  @Post('from-template/:templateId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'generate', entityType: 'GeneratedDocument' })
  generate(
    @Param('templateId') templateId: string,
    @Body() dto: GenerateDocumentOptionsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const { name, ...buildDto } = dto;
    return this.service.generate(templateId, buildDto, { name }, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'GeneratedDocument' })
  remove(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
