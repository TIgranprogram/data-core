import { AppSection } from '../../common/decorators/app-section.decorator';
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
import { ProductPhotoService } from './product-photo.service';
import { AttachProductPhotoDto, UpdateProductPhotoDto } from './product-photo.dto';

@AppSection('products')
@Controller('products/:productId/photos')
export class ProductPhotoController {
  constructor(private readonly service: ProductPhotoService) {}

  @Get()
  @Roles('admin', 'manager', 'user')
  list(@Param('productId') productId: string, @Query('purpose') purpose?: string) {
    return this.service.findByProduct(productId, purpose);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach-photo', entityType: 'ProductPhoto' })
  attach(@Param('productId') productId: string, @Body() body: AttachProductPhotoDto) {
    return this.service.upsert({ productId, ...body });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-photo', entityType: 'ProductPhoto' })
  patch(@Param('id') id: string, @Body() body: UpdateProductPhotoDto) {
    return this.service.patch(id, body);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'detach-photo', entityType: 'ProductPhoto' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
