import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TaskPhotoDto } from '../../common/dto/task-photo.dto';
import { TaskNoteContentDto } from '../../common/task-note-photos';
import { WorkMediaService } from './work-media.service';

@ApiTags('В работе')
@AppSection('work')
@Controller('work-tasks/:id')
export class WorkMediaController {
  constructor(private readonly media: WorkMediaService) {}

  @Get('notes')
  @Roles('admin', 'director', 'manager', 'user')
  notes(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.listNotes(id, user);
  }

  @Post('notes')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worknote.created', entityType: 'WorkNote' })
  createNote(@Param('id') id: string, @Body() dto: TaskNoteContentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.createNote(id, dto, user);
  }

  @Delete('notes/:noteId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worknote.deleted', entityType: 'WorkNote', idParam: 'noteId' })
  removeNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.removeNote(id, noteId, user);
  }

  @Get('photos')
  @Roles('admin', 'director', 'manager', 'user')
  photos(@Param('id') id: string) {
    return this.media.photos(id);
  }

  @Post('photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  addPhoto(@Param('id') id: string, @Body() dto: TaskPhotoDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.changePhoto(id, dto.photoId, 'added', user);
  }

  @Patch('photos/main')
  @Roles('admin', 'manager')
  setMainPhoto(@Param('id') id: string, @Body() dto: TaskPhotoDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.changePhoto(id, dto.photoId, 'main', user);
  }

  @Delete('photos/:photoId')
  @Roles('admin', 'manager')
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.changePhoto(id, photoId, 'removed', user);
  }
}
