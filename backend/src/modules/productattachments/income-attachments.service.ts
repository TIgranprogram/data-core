import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Income, IncomeDocument } from '../incomes/income.schema';
import { isObjectIdStr } from './attachment-paths';
import { ProductAttachmentsService, type UploadedAttachmentFile } from './productattachments.service';

/**
 * Файлы позиции заказа (C121): `/api/incomes/:id/attachments`. Позиция даёт изделие (`productId`);
 * файлы изделия видны в списке с `scope:'product'`, файлы самой позиции — `scope:'line'` (в других позициях их нет).
 * Хранение, лимиты, формат и скачивание (тикет) — как у вложений изделия.
 */
@Injectable()
export class IncomeAttachmentsService {
  constructor(
    @InjectModel(Income.name) private readonly incomes: Model<IncomeDocument>,
    private readonly files: ProductAttachmentsService,
  ) {}

  /** Изделие позиции. Нет позиции — 404; позиция без изделия (услуга, заявка на новое) — 400. */
  async productOf(incomeId: string): Promise<string> {
    if (!isObjectIdStr(incomeId)) throw new NotFoundException('Позиция не найдена.');
    const row = await this.incomes.findOne({ _id: new Types.ObjectId(incomeId), deletedAt: null }, { productId: 1 }).lean().exec();
    if (!row) throw new NotFoundException('Позиция не найдена.');
    if (!row.productId) throw new BadRequestException('У позиции нет изделия — файлы к ней не прикрепить.');
    return String(row.productId);
  }

  list(incomeId: string) {
    return this.productOf(incomeId).then((productId) => this.files.list(productId, false, incomeId));
  }

  /** До приёма файла (см. `AttachmentUploadGuard`): позиция, вид, место на диске. */
  preflight(incomeId: string, typeId: string, incoming: number) {
    return this.productOf(incomeId).then((productId) => this.files.preflight(productId, typeId, incoming));
  }

  async save(file: UploadedAttachmentFile | undefined, incomeId: string, typeId: string, user: AuthenticatedUser) {
    const productId = await this.productOf(incomeId).catch(async (e) => { if (file?.path) await fs.rm(file.path, { force: true }); throw e; });
    return this.files.save(file, productId, typeId, user, incomeId);
  }

  async remove(incomeId: string, aid: string, user: AuthenticatedUser) {
    return this.files.remove(await this.productOf(incomeId), aid, user, incomeId);
  }
}
