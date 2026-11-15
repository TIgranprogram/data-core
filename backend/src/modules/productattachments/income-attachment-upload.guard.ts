import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { IncomeAttachmentsService } from './income-attachments.service';

/** То же, что `AttachmentUploadGuard`, но для позиции заказа: до приёма тела — позиция, вид, место на диске. */
@Injectable()
export class IncomeAttachmentUploadGuard implements CanActivate {
  constructor(private readonly service: IncomeAttachmentsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    req.setTimeout(0);
    const incoming = Number(req.headers['content-length']) || 0;
    await this.service.preflight(String(req.params.id), String(req.query.typeId ?? ''), incoming);
    return true;
  }
}
