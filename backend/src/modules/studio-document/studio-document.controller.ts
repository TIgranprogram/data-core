import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { StudioDocumentService } from './studio-document.service';
import { CreateStudioDocumentDto } from './dto/create-studio-document.dto';
import { CreateStudioDocumentFromTemplateDto } from './dto/create-studio-document-from-template.dto';
import { UpdateStudioDocumentDto } from './dto/update-studio-document.dto';
import { PutStudioDataSetDto } from './dto/put-studio-data-set.dto';
import { SaveAsTemplateDto } from './dto/save-as-template.dto';
import { CreateStudioBlockDto } from './dto/create-studio-block.dto';
import { UpdateStudioBlockLayoutsDto } from './dto/update-studio-block-layouts.dto';
import { ReorderStudioBlocksDto } from './dto/reorder-studio-blocks.dto';
import { TemplateBlockService } from '../template-block/template-block.service';
import { StudioOutputService } from './studio-output.service';
import { StudioQuotationLifecycleService } from './studio-quotation-lifecycle.service';
import { UpdateStudioQuotationStatusDto } from './dto/update-studio-quotation-status.dto';

/**
 * TZ-DOC-STUDIO-201b — REST surface for StudioDocument (org-scoped, revision gate).
 * TZ-DOC-STUDIO-401 — nested blocks facade (org-scoped via studio doc lookup).
 *
 * JwtAuthGuard is global (APP_GUARD). organizationId always from req.user.
 */
@ApiTags('Document Studio — StudioDocument')
@Controller('studio-documents')
export class StudioDocumentController {
  constructor(
    private readonly service: StudioDocumentService,
    private readonly blockService: TemplateBlockService,
    private readonly output: StudioOutputService,
    private readonly quotationLifecycle: StudioQuotationLifecycleService,
  ) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List studio documents (org-scoped)' })
  @ApiResponse({ status: 200 })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.organizationId);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get studio document by ID (org-scoped)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Foreign org scope' })
  @ApiResponse({ status: 404 })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'StudioDocument' })
  @ApiOperation({ summary: 'Create a studio document (manager+)' })
  @ApiResponse({ status: 201 })
  create(
    @Body() dto: CreateStudioDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.organizationId, user.id);
  }

  @Post('from-template')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create-from-template', entityType: 'StudioDocument' })
  @ApiOperation({ summary: 'Create studio document from DocumentTemplate + cloned blocks' })
  @ApiResponse({ status: 201 })
  createFromTemplate(
    @Body() dto: CreateStudioDocumentFromTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createFromTemplate(
      dto.templateId,
      user.organizationId,
      user.id,
      dto.name,
    );
  }

  @Post(':id/duplicate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'duplicate', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Duplicate studio document + blocks as new draft' })
  @ApiResponse({ status: 201 })
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.duplicate(id, user.organizationId, user.id);
  }

  @Post(':id/save-as-template')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'save-as-template', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Save studio document as DocumentTemplate + cloned blocks' })
  @ApiResponse({ status: 201 })
  saveAsTemplate(
    @Param('id') id: string,
    @Body() dto: SaveAsTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveAsTemplate(id, user.organizationId, user.id, dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Update studio document (expectedRevision required)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'STUDIO_DOCUMENT_REVISION_CONFLICT' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStudioDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user.organizationId, user.id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'StudioDocument', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a studio document (manager+)' })
  @ApiResponse({ status: 204 })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user.organizationId);
  }

  @Put(':id/data-sets/:key')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-data-set', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Upsert a dataSet entry (expectedRevision required)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'STUDIO_DOCUMENT_REVISION_CONFLICT' })
  putDataSet(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: PutStudioDataSetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.putDataSet(id, key, dto, user.organizationId, user.id);
  }

  @Get(':id/blocks')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List blocks for a studio document (org-scoped)' })
  @ApiResponse({ status: 200 })
  async listBlocks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.findById(id, user.organizationId);
    return this.blockService.findAllByStudioDocument(id);
  }

  @Post(':id/blocks')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'TemplateBlock' })
  @ApiOperation({ summary: 'Create a block on a studio document (expectedRevision required)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'STUDIO_DOCUMENT_REVISION_CONFLICT' })
  async addBlock(
    @Param('id') id: string,
    @Body() dto: CreateStudioBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { expectedRevision, ...blockDto } = dto;
    return this.service.addBlock(
      id,
      expectedRevision,
      blockDto,
      user.organizationId,
      user.id,
    );
  }

  @Patch(':id/blocks/layouts')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-layouts', entityType: 'TemplateBlock' })
  @ApiOperation({ summary: 'Batch-update block layouts (expectedRevision required)' })
  @ApiResponse({ status: 409, description: 'STUDIO_DOCUMENT_REVISION_CONFLICT' })
  async updateBlockLayouts(
    @Param('id') id: string,
    @Body() dto: UpdateStudioBlockLayoutsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { expectedRevision, ...layoutsDto } = dto;
    return this.service.updateBlockLayouts(
      id,
      expectedRevision,
      layoutsDto,
      user.organizationId,
      user.id,
    );
  }

  @Post(':id/blocks/reorder')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'reorder', entityType: 'TemplateBlock' })
  @ApiOperation({ summary: 'Reorder blocks (expectedRevision required)' })
  @ApiResponse({ status: 409, description: 'STUDIO_DOCUMENT_REVISION_CONFLICT' })
  async reorderBlocks(
    @Param('id') id: string,
    @Body() dto: ReorderStudioBlocksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { expectedRevision, blockIds } = dto;
    return this.service.reorderBlocks(
      id,
      expectedRevision,
      blockIds,
      user.organizationId,
      user.id,
    );
  }

  @Post(':id/preview')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Render studio document preview HTML (Wave 9)' })
  preview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.output.preview(id, user);
  }

  @Post(':id/ensure-quotation')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'ensure-quotation', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Ensure linked draft Quotation for KP studio document (S20)' })
  async ensureQuotation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const doc = await this.service.findById(id, user.organizationId);
    const result = await this.quotationLifecycle.ensureLinkedQuotation(doc, user.organizationId!);
    return { studioDocument: result.doc, quotation: result.quotation };
  }

  @Post(':id/sync-quotation')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'sync-quotation', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Sync Quotation items from studio data resolver (S20)' })
  async syncQuotation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const doc = await this.service.findById(id, user.organizationId);
    const quotation = await this.quotationLifecycle.syncQuotationItems(doc, user.organizationId!);
    return { studioDocument: doc, quotation };
  }

  @Patch(':id/quotation-status')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-quotation-status', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Update linked Quotation status from studio (S20)' })
  async updateQuotationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStudioQuotationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const doc = await this.service.findById(id, user.organizationId);
    const quotation = await this.quotationLifecycle.updateQuotationStatus(
      doc,
      dto.status,
      user.organizationId!,
    );
    const refreshed = await this.service.findById(id, user.organizationId);
    return { studioDocument: refreshed, quotation };
  }

  @Post(':id/finalize')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'finalize', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Finalize studio document → GeneratedDocument archive (Wave 10)' })
  finalize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.output.finalize(id, user);
  }

  @Post(':id/pdf')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'generate_pdf', entityType: 'StudioDocument', idParam: 'id' })
  @ApiOperation({ summary: 'Generate PDF from studio document (Wave 10)' })
  async pdf(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const rendered = await this.output.renderPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(rendered.name)}.pdf"`,
    );
    res.send(rendered.buffer);
  }
}
