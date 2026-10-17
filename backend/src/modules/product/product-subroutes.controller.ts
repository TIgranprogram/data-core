import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductService } from './product.service';

interface AttachPhotoDto {
  photoId: string;
}

@Controller('products/:id')
export class ProductSubroutesController {
  constructor(private readonly productService: ProductService) {}

  @Post('photos')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach-photo', entityType: 'Product' })
  async attachPhoto(@Param('id') id: string, @Body() dto: AttachPhotoDto) {
    if (!dto?.photoId?.trim()) {
      throw new BadRequestException('photoId обязателен');
    }
    const doc = await this.productService.findById(id);
    const ids = new Set((doc.photoIds ?? []).map((p) => String(p)));
    ids.add(dto.photoId.trim());
    return this.productService.update(id, { photoIds: [...ids] } as never);
  }
}
