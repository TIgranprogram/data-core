import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { ContractService } from './contract.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { SignContractDto } from './dto/sign-contract.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@ApiTags('Закупки — Контракты')
@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('contracts')
export class ContractController {
  constructor(private readonly service: ContractService) {}

  @Get()
  @ApiOperation({ summary: 'List all contracts with optional filters' })
  @ApiQuery({ name: 'counterpartyId', required: false, description: 'Filter by counterparty' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO)' })
  @ApiResponse({ status: 200, description: 'List of contracts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Query('counterpartyId') counterpartyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(
      counterpartyId,
      status,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contract by ID' })
  @ApiResponse({ status: 200, description: 'Contract found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Contract' })
  @ApiOperation({ summary: 'Create a new contract' })
  @ApiResponse({ status: 201, description: 'Contract created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateContractDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Contract' })
  @ApiOperation({ summary: 'Update an existing contract' })
  @ApiResponse({ status: 200, description: 'Contract updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/attachment')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach_file', entityType: 'Contract', idParam: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a contract file' })
  @ApiResponse({ status: 200, description: 'Contract file attached' })
  @ApiResponse({ status: 400, description: 'File is missing or empty' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  attachFile(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || file.size <= 0) {
      throw new BadRequestException('File is required and must not be empty (multipart field: file)');
    }
    return this.service.attachFile(id, file);
  }

  @Delete(':id/attachment')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'remove_attachment', entityType: 'Contract', idParam: 'id' })
  @ApiOperation({ summary: 'Remove the attached contract file' })
  @ApiResponse({ status: 200, description: 'Contract file removed' })
  @ApiResponse({ status: 404, description: 'Contract or attachment not found' })
  removeAttachment(@Param('id') id: string) {
    return this.service.removeAttachment(id);
  }

  @Post(':id/sign')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'sign', entityType: 'Contract' })
  @ApiOperation({ summary: 'Sign a contract' })
  @ApiResponse({ status: 200, description: 'Contract signed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  sign(@Param('id') id: string, @Body() dto: SignContractDto) {
    return this.service.sign(id, dto.signedAt);
  }

  @Post(':id/activate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'activate', entityType: 'Contract' })
  @ApiOperation({ summary: 'Activate a signed contract' })
  @ApiResponse({ status: 200, description: 'Contract activated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Contract' })
  @ApiOperation({ summary: 'Delete a contract' })
  @ApiResponse({ status: 200, description: 'Contract deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
