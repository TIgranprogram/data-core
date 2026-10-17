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
import { PurchaseRequestService } from './purchase-request.service';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../common/decorators/is-object-id.decorator';

class ConvertDto {
  @IsObjectId()
  supplierId!: string;

  @IsOptional() @IsString() title?: string;
}

@Controller('purchase-requests')
export class PurchaseRequestController {
  constructor(private readonly service: PurchaseRequestService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'PurchaseRequest' })
  create(@Body() dto: CreatePurchaseRequestDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'PurchaseRequest' })
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseRequestDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/convert-to-purchase-order')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'convert', entityType: 'PurchaseRequest' })
  convert(@Param('id') id: string, @Body() dto: ConvertDto) {
    return this.service.convertToPurchaseOrder(id, dto.supplierId, dto.title);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'PurchaseRequest' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
