import {
  BadRequestException,
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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationService } from './organization.service';
import type { OrganizationAssetRole } from './organization.schema';

@ApiTags('Справочники — Организации')
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'List all organizations with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name' })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by organization type' })
  @ApiResponse({ status: 200, description: 'Paginated list of organizations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('type') type?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll(
      { page: parseInt(page, 10), limit: parseInt(limit, 10), search, type },
      user,
    );
  }

  /** TZ-PARTY-301 — «наша фирма» for documents. Declared before `:id`. */
  @Get('current')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get the organization used as our own company' })
  @ApiResponse({ status: 200, description: 'Our organization' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Our organization is not configured' })
  findCurrent(@CurrentUser() user?: AuthenticatedUser) {
    return this.service.findCurrent(user);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiResponse({ status: 200, description: 'Organization found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.findById(id, user);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Organization' })
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateOrganizationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Organization', idParam: 'id' })
  @ApiOperation({ summary: 'Update an existing organization' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Organization', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  remove(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.remove(id, user);
  }

  /**
   * TZ-ORG-ASSETS-301 — положить файл в слот `logo` / `seal` / `signature`.
   * PUT, а не POST: слот один, повторная загрузка заменяет содержимое.
   */
  @Put(':id/assets/:role')
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('file'))
  @AuditAction({ action: 'put_asset', entityType: 'Organization', idParam: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Загрузить логотип / печать / подпись организации',
    description:
      'Поле формы: `file`. Слот один на роль — новый файл заменяет прежний, ' +
      'старая картинка удаляется. Печать (`seal`) меняет только admin.',
  })
  @ApiResponse({ status: 200, description: 'Файл записан в слот' })
  @ApiResponse({ status: 400, description: 'Файл не передан' })
  @ApiResponse({ status: 403, description: 'Печать меняет только администратор' })
  @ApiResponse({ status: 404, description: 'Организация или слот не найдены' })
  putAsset(
    @Param('id') id: string,
    @Param('role') role: string,
    @UploadedFile()
    file?: { filename: string; originalname?: string; mimetype?: string; size?: number },
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не передан: поле формы должно называться «file».');
    }
    return this.service.putAsset(
      id,
      role as OrganizationAssetRole,
      file,
      user,
      user?.id,
    );
  }

  @Delete(':id/assets/:role')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'remove_asset', entityType: 'Organization', idParam: 'id' })
  @ApiOperation({ summary: 'Снять файл со слота организации' })
  @ApiResponse({ status: 200, description: 'Слот очищен' })
  @ApiResponse({ status: 403, description: 'Печать меняет только администратор' })
  @ApiResponse({ status: 404, description: 'Организация или файл в слоте не найдены' })
  removeAsset(
    @Param('id') id: string,
    @Param('role') role: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.removeAsset(id, role as OrganizationAssetRole, user);
  }
}
