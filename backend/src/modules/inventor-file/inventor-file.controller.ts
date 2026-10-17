import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { InventorFileService } from './inventor-file.service';
import { CreateInventorFileDto } from './dto/create-inventor-file.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class InventorFileController {
  constructor(private readonly service: InventorFileService) {}

  @Post('products/:productId/inventor-files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @Roles('admin', 'manager')
  @AuditAction({ action: 'upload', entityType: 'InventorFile' })
  async upload(
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateInventorFileDto,
  ) {
    return this.service.saveUpload(productId, file, body);
  }

  @Get('products/:productId/inventor-files')
  listForProduct(@Param('productId') productId: string) {
    return this.service.findAll(productId);
  }

  @Get('inventor-files')
  findAll(@Query('productId') productId?: string) {
    return this.service.findAll(productId);
  }

  @Get('inventor-files/:id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { doc, absPath } = await this.service.getFilePath(id);
    res.setHeader('Content-Type', doc.fileType ?? 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
    );
    res.sendFile(absPath);
  }

  @Delete('inventor-files/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'InventorFile' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }
}
