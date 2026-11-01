import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { narrowToZone, type StockScope } from '../../common/stock-scope';
import type { CloseMaterialRequestDto, CreateMaterialRequestDto } from './dto';
import { MaterialRequest, MaterialRequestDocument } from './material-request.schema';

const uid = (id?: string) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);

/** Условие видимости: заявки своих складов (и без склада); весь склад (`scope` null) — все. */
export function scopeFilter(scope: StockScope | null): Record<string, unknown> {
  if (!scope) return {};
  const ids = scope.zones.map((z) => new Types.ObjectId(z.id));
  return { $or: [{ zoneId: { $in: ids } }, { zoneId: null }, { zoneId: { $exists: false } }] };
}

type Author = { id?: string; username?: string };

@Injectable()
export class MaterialRequestsService {
  constructor(@InjectModel(MaterialRequest.name) private readonly model: Model<MaterialRequestDocument>) {}

  /** Подать заявку: склад проверяется по доступу пользователя. */
  async create(dto: CreateMaterialRequestDto, scope: StockScope | null, user?: Author) {
    if (dto.zoneId) narrowToZone(scope, dto.zoneId);
    const doc = await this.model.create({
      text: dto.text.trim(), qty: dto.qty && dto.qty > 0 ? dto.qty : undefined, zoneId: uid(dto.zoneId), status: 'open',
      createdBy: uid(user?.id), createdByName: user?.username || undefined,
    });
    return this.out(doc.toObject());
  }

  async list(scope: StockScope | null, status = 'open') {
    const filter: Record<string, unknown> = { deletedAt: null, ...scopeFilter(scope) };
    if (status !== 'all') filter.status = ['open', 'done', 'rejected'].includes(status) ? status : 'open';
    const items = await this.model.find(filter).sort({ createdAt: -1 }).limit(200).lean().exec();
    return { items: items.map((x) => this.out(x)), total: items.length };
  }

  async count(scope: StockScope | null) {
    return { open: await this.model.countDocuments({ deletedAt: null, status: 'open', ...scopeFilter(scope) }) };
  }

  /** Закрыть: «позиция создана» (done) или «отклонить» (rejected). Закрытую повторно не закрыть. */
  async close(id: string, dto: CloseMaterialRequestDto, scope: StockScope | null, userId?: string) {
    const doc = await this.model.findOne({ _id: id, deletedAt: null, ...scopeFilter(scope) }).exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    if (doc.status !== 'open') throw new ConflictException('Заявка уже закрыта');
    doc.status = dto.status;
    doc.materialId = dto.status === 'done' ? uid(dto.materialId) : undefined;
    doc.closedBy = uid(userId);
    doc.closedAt = new Date();
    await doc.save();
    return this.out(doc.toObject());
  }

  private out(x: Record<string, any>) {
    return { id: String(x._id), text: x.text, qty: x.qty ?? null, zoneId: x.zoneId ? String(x.zoneId) : null, status: x.status,
      materialId: x.materialId ? String(x.materialId) : null, createdByName: x.createdByName || '', createdAt: x.createdAt, closedAt: x.closedAt ?? null };
  }
}
