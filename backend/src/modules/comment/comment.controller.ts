import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Request } from 'express';
import { CommentService } from './comment.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('comments')
export class CommentController {
  constructor(private readonly service: CommentService) {}

  @Get()
  findAll(
    @Query('packageTag') packageTag?: string,
    @Query('isArchived') isArchived?: string,
  ) {
    return this.service.findAll(
      packageTag,
      isArchived === undefined ? undefined : isArchived === 'true',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Comment' })
  create(@Body() dto: CreateCommentDto, @Req() req: Request) {
    const user = (req as unknown as { user?: { sub: string; email?: string } }).user;
    const authorId = user?.sub ?? '000000000000000000000000';
    const author = user?.email;
    return this.service.create(dto, authorId, author);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Comment' })
  update(@Param('id') id: string, @Body() dto: UpdateCommentDto, @Req() req: Request) {
    const user = (req as unknown as { user?: { sub: string; role?: string } }).user;
    const requesterId = user?.sub ?? '';
    const isAdmin = user?.role === 'admin';
    return this.service.update(id, dto, requesterId, isAdmin);
  }

  @Post(':id/archive')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'archive', entityType: 'Comment' })
  archive(@Param('id') id: string) {
    return this.service.archive(id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Comment' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
