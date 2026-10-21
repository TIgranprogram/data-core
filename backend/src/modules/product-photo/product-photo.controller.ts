import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductPhotoService, UpsertProductPhotoDto } from './product-photo.service';

@Controller('products/:productId/photos')
export class ProductPhotoController {
  constructor(private readonly service: ProductPhotoService) {}

  @Get()
  @Roles('admin', 'manager', 'user')
  list(@Param('productId') productId: string) {
    return this.service.findByProduct(productId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach-photo', entityType: 'ProductPhoto' })
  attach(@Param('productId') productId: string, @Body() body: Omit<UpsertProductPhotoDto, 'productId'>) {
    return this.service.upsert({ productId, ...body });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'detach-photo', entityType: 'ProductPhoto' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
