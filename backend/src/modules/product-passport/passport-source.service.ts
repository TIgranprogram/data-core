import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { assertPassportToken, claimPassportLine, epochOf, passportLine, stalePassport, revisionOf, selectionOf } from '../../common/passport/line-source';
import { attachmentAvailable, presentSourceAttachment } from '../productattachments/attachment-availability';
import { ProductAttachmentsService } from '../productattachments/productattachments.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProductPassportService } from './product-passport.service';
import { PassportCandidatesDto, PassportSourceDto } from './dto/passport-source.dto';

const unavailable = () => new ConflictException({ code: 'ATTACHMENT_UNAVAILABLE', message: 'Файл недоступен — выберите другое вложение' });
@Injectable()
export class PassportSourceService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly passports: ProductPassportService, private readonly files: ProductAttachmentsService) {}
  private get db() { return this.connection.db!; }
  async view(orderId: string, incomeId: string) {
    await passportLine(this.db, incomeId, orderId);
    const plan = await this.passports.orderPlan(orderId);
    const l = plan.lines.find(l => l.incomeId === incomeId)!;
    return { orderId, incomeId, productId: l.productId, selection: l.selection, passportEpoch: l.passportEpoch, contextToken: l.contextToken, effectiveState: l.state, missing: l.missing, attachment: l.attachment, sitePassports: l.sitePassports };
  }
  async candidates(orderId: string, incomeId: string, q: PassportCandidatesDto) {
    const inc = await passportLine(this.db, incomeId, orderId);
    const page = q.page ?? 1, limit = q.limit ?? 20;
    if (!inc.productId || inc.lineType === 'service') return { items: [], total: 0, page, limit };
    const filter = { productId: inc.productId, deletedAt: null };
    const [rows, total] = await Promise.all([this.db.collection('productattachments').find(filter).sort({ uploadedAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(), this.db.collection('productattachments').countDocuments(filter)]);
    const types = await this.db.collection('dict_values').find({ _id: { $in: rows.map(r => r.typeId) } }, { projection: { name: 1 } }).toArray();
    const names = new Map(types.map(t => [String(t._id), String(t.name ?? '')]));
    const items = [];
    for (let i = 0; i < rows.length; i += 8) items.push(...await Promise.all(rows.slice(i, i + 8).map(r => presentSourceAttachment(r, names.get(String(r.typeId)) ?? ''))));
    return { items, total, page, limit };
  }
  private async baseline(orderId: string, incomeId: string, token: string) {
    const inc = await passportLine(this.db, incomeId, orderId);
    const s = selectionOf(inc);
    const file = s.attachmentId ? await this.db.collection('productattachments').findOne({ _id: new Types.ObjectId(String(s.attachmentId)) }) : null;
    assertPassportToken(token, inc, file ? Number(file.selectionGeneration ?? 0) : undefined);
    return inc;
  }
  async select(orderId: string, incomeId: string, dto: PassportSourceDto, actor: AuthenticatedUser) {
    if (dto.mode === 'site' && (dto.attachmentId !== undefined || dto.confirm !== undefined || dto.expectedAttachmentGeneration !== undefined) || dto.mode === 'attachment' && (!dto.attachmentId || dto.confirm !== true || dto.expectedAttachmentGeneration === undefined)) throw new BadRequestException('Подтвердите выбранный файл паспорта; для паспорта сайта файл не задаётся');
    const inc = await this.baseline(orderId, incomeId, dto.contextToken);
    if (revisionOf(inc) !== dto.expectedRevision) throw new ConflictException({ code: 'STALE_CONTEXT', message: 'Выбор изменился — перечитайте позицию' });
    const file = dto.mode === 'attachment' ? await this.db.collection('productattachments').findOne({ _id: new Types.ObjectId(dto.attachmentId!), productId: inc.productId, deletedAt: null }) : null;
    if (dto.mode === 'attachment' && (!inc.productId || inc.lineType === 'service' || !await attachmentAvailable(file) || Number(file?.selectionGeneration ?? 0) !== dto.expectedAttachmentGeneration)) throw unavailable();
    const now = new Date();
    const selection = { mode: dto.mode, revision: dto.expectedRevision + 1, changedAt: now, changedBy: actor.id, ...(file ? { attachmentId: file._id, attachmentGeneration: Number(file.selectionGeneration ?? 0), productIdAtSelection: inc.productId, confirmedAt: now, confirmedBy: actor.id } : {}) };
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await claimPassportLine(this.db, session, inc, epochOf(inc), 'select');
        if (file) {
          const generation = Number(file.selectionGeneration ?? 0);
          const r = await this.db.collection('productattachments').updateOne({ _id: file._id, productId: inc.productId, deletedAt: null, fileRemovedAt: null, purgeState: { $ne: 'purging' }, ...(generation ? { selectionGeneration: generation } : { $or: [{ selectionGeneration: 0 }, { selectionGeneration: { $exists: false } }] }) }, { $inc: { selectionGuard: 1 } }, { session });
          if (!r.modifiedCount) throw unavailable();
        }
        await this.db.collection('incomes').updateOne({ _id: inc._id }, { $set: { passportSelection: selection } }, { session });
        await this.db.collection('auditlogs').insertOne({ action: 'passport.selection.changed', entityType: 'Income', entityId: inc._id, userId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : undefined, createdAt: now, details: { before: selectionOf(inc), after: selection, meta: { orderId, productId: inc.productId } } }, { session });
      });
    } finally { await session.endSession(); }
    return this.view(orderId, incomeId);
  }
  async ticket(orderId: string, incomeId: string, token: string, actor: AuthenticatedUser) {
    const inc = await this.baseline(orderId, incomeId, token);
    const view = await this.view(orderId, incomeId);
    if (view.contextToken !== token) throw stalePassport();
    if (selectionOf(inc).mode !== 'attachment' || view.effectiveState !== 'attached' || !view.attachment?.available) throw unavailable();
    const t = await this.files.ticket(String(inc.productId), view.attachment.id, actor);
    return { ...t, url: `/api/products/${inc.productId}/attachments/${view.attachment.id}/file?t=${t.ticket}` };
  }
}
