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
  Query,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ProductModulePhotoService,
  UpsertProductModulePhotoDto,
} from './product-module-photo.service';

@Controller('product-module-photos')
export class ProductModulePhotoController {
  constructor(private readonly service: ProductModulePhotoService) {}

  @Get()
  @Roles('admin', 'manager', 'user')
  list(@Query('productModuleId') productModuleId: string) {
    return this.service.findByProductModule(productModuleId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach-photo', entityType: 'ProductModulePhoto' })
  attach(@Body() dto: UpsertProductModulePhotoDto) {
    return this.service.upsert(dto);
  }

  /**
   * TZ-83 Фаза A.7: явный atomic route для setMain (вместо PATCH с isMain=true
   * который менее выразителен и легче забыть audit-action).
   */
  @Post(':id/main')
  @Roles('admin', 'manager')
  @AuditAction({
    action: 'set-main-photo',
    entityType: 'ProductModulePhoto',
    idParam: 'id',
  })
  async setMain(@Param('id') id: string) {
    await this.service.setMain(id);
    return { ok: true };
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({
    action: 'update-photo',
    entityType: 'ProductModulePhoto',
    idParam: 'id',
  })
  update(
    @Param('id') id: string,
    @Body() dto: Partial<UpsertProductModulePhotoDto>,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({
    action: 'detach-photo',
    entityType: 'ProductModulePhoto',
    idParam: 'id',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
