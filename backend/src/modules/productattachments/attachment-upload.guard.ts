import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ProductAttachmentsService } from './productattachments.service';

/**
 * Перед приёмом тела (до multer): изделие и вид существуют, на диске хватает места.
 * Так 500 МБ не пишутся на диск ради отказа. Заодно снимается таймаут сокета — на узком канале файл идёт долго.
 */
@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  constructor(private readonly service: ProductAttachmentsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    req.setTimeout(0);
    const incoming = Number(req.headers['content-length']) || 0;
    await this.service.preflight(String(req.params.id), String(req.query.typeId ?? ''), incoming);
    return true;
  }
}
