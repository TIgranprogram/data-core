import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductPassportService } from './product-passport.service';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class ProductPassportController {
  constructor(private readonly service: ProductPassportService) {}

  @Get('products/:productId/passport')
  findByProduct(@Param('productId') productId: string) {
    return this.service.findByProductId(productId);
  }

  @Post('products/:productId/passport')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ProductPassport' })
  createForProduct(
    @Param('productId') productId: string,
    @Body() dto: CreateProductPassportDto,
  ) {
    if (dto.productId && dto.productId !== productId) {
      // align: prefer URL param
      dto.productId = productId;
    }
    return this.service.create({ ...dto, productId });
  }

  @Get('passports')
  findAll(@Query('productId') productId?: string) {
    return this.service.findAll(productId);
  }

  @Get('passports/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('passports/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ProductPassport' })
  update(@Param('id') id: string, @Body() dto: UpdateProductPassportDto) {
    return this.service.update(id, dto);
  }

  @Delete('passports/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ProductPassport' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
