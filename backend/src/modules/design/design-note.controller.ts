import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DesignNoteDto, DesignNoteEditDto } from './dto/design-note.dto';
import { DesignNoteService } from './design-note.service';

/**
 * Обсуждение задач проектирования. Читать и писать — все роли раздела `design`;
 * править и удалять — автор (15 минут) или admin. Перенос из YouGile — POST с полями source/authorName/createdAt/externalId от admin.
 */
@ApiTags('Проектирование')
@AppSection('design')
@Controller()
export class DesignNoteController {
  constructor(private readonly notes: DesignNoteService) {}

  @Get('design-tasks/:id/notes')
  @Roles('admin', 'director', 'manager', 'user')
  list(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.list(id, user);
  }

  @Post('design-tasks/:id/notes')
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'designnote.created', entityType: 'DesignTask', idParam: 'id' })
  create(@Param('id') id: string, @Body() dto: DesignNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.create(id, dto, user);
  }

  /** Объявлен до `:id`. */
  @Get('design-notes/open-questions')
  @Roles('admin', 'director', 'manager', 'user')
  openQuestions(@Query() q: Record<string, string>, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.openQuestions(q, user);
  }

  @Patch('design-notes/:id')
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'designnote.updated', entityType: 'DesignNote', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: DesignNoteEditDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.update(id, dto.text, user);
  }

  @Delete('design-notes/:id')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'designnote.deleted', entityType: 'DesignNote', idParam: 'id' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.remove(id, user);
  }
}
