import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import { ProductPhoto, ProductPhotoDocument } from './product-photo.schema';
import { checkPurposeKind, purposeFilter } from './product-photo-purpose';

export interface UpsertProductPhotoDto {
  productId: string;
  photoId?: string;
  url?: string;
  caption?: string;
  isMain?: boolean;
  sortOrder?: number;
  purpose?: string;
  kind?: string;
}

const isShowcase = (d: { purpose?: string | null }) => !d.purpose || d.purpose === 'showcase';
const importedKind = (purpose: unknown, kind: unknown) => purpose === 'passport' && ['overview', 'dimensions', 'foundation', 'mounting'].includes(String(kind));

@Injectable()
export class ProductPhotoService {
  constructor(
    @InjectModel(ProductPhoto.name) private readonly model: Model<ProductPhotoDocument>,
  ) {}

  /** C172: общий product-write сериализует ручную связь с атомарным импортом. */
  private async passportWrite<T>(productId: Types.ObjectId, write: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.model.db.startSession();
    let result!: T;
    try {
      await session.withTransaction(async () => {
        const found = await this.model.db.db!.collection('products').updateOne({ _id: productId, deletedAt: null }, { $inc: { __v: 1 }, $set: { updatedAt: new Date() } }, { session });
        if (!found.matchedCount) throw new NotFoundException('Изделие не найдено');
        result = await write(session);
      });
      return result;
    } finally { await session.endSession(); }
  }

  async upsert(dto: UpsertProductPhotoDto): Promise<ProductPhotoDocument> {
    checkPurposeKind(dto.purpose, dto.kind);
    const productId = new Types.ObjectId(dto.productId);
    const purpose = dto.purpose && dto.purpose !== 'showcase' ? dto.purpose : undefined;
    if (dto.isMain && !purpose) {
      // главное — только среди витринных фото; рисунки паспорта главными не бывают
      await this.model.updateMany({ productId, ...purposeFilter() }, { $set: { isMain: false } }).exec();
    }
    const data = {
      productId,
      photoId: dto.photoId ? new Types.ObjectId(dto.photoId) : undefined,
      url: dto.url,
      caption: dto.caption,
      isMain: purpose ? false : dto.isMain ?? false,
      sortOrder: dto.sortOrder ?? 0,
      ...(purpose ? { purpose } : {}),
      ...(dto.kind ? { kind: dto.kind } : {}),
    };
    if (importedKind(purpose, dto.kind)) return this.passportWrite(productId, async session => (await this.model.create([data], { session }))[0]);
    return this.model.create(data);
  }

  /** Без `purpose` — витрина и записи без поля (как до purpose); `passport` / `drawing` — своё назначение. */
  async findByProduct(productId: string, purpose?: string): Promise<ProductPhotoDocument[]> {
    const filter = purposeFilter(purpose);
    return this.model
      .find({ productId: new Types.ObjectId(productId), deletedAt: null, ...filter })
      .populate('photoId')
      .sort({ isMain: -1, sortOrder: 1, createdAt: 1 })
      .exec();
  }

  /** Правка подписи, порядка, вида рисунка; вид — только у фото «для паспорта». */
  async patch(id: string, body: { caption?: string; isMain?: boolean; sortOrder?: number; kind?: string }): Promise<ProductPhotoDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`ProductPhoto ${id} not found`);
    const cur = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!cur) throw new NotFoundException(`ProductPhoto ${id} not found`);
    if (body.kind !== undefined) checkPurposeKind(cur.purpose ?? 'showcase', body.kind);
    const set: Record<string, unknown> = {};
    for (const k of ['caption', 'sortOrder', 'kind'] as const) if (body[k] !== undefined) set[k] = body[k];
    if (body.isMain !== undefined) {
      if (body.isMain && isShowcase(cur)) await this.model.updateMany({ productId: cur.productId, ...purposeFilter() }, { $set: { isMain: false } }).exec();
      set.isMain = isShowcase(cur) ? body.isMain : false;
    }
    if (importedKind(cur.purpose, cur.kind) || importedKind(cur.purpose, body.kind)) {
      await this.passportWrite(cur.productId, async session => {
        const fresh = await this.model.findOne({ _id: id, deletedAt: null }).session(session).exec();
        if (!fresh || String(fresh.productId) !== String(cur.productId) || fresh.kind !== cur.kind || fresh.purpose !== cur.purpose) throw new NotFoundException('Связь рисунка изменилась — перечитайте изделие');
        await this.model.updateOne({ _id: id }, { $set: set }, { session }).exec();
      });
    } else await this.model.updateOne({ _id: id }, { $set: set }).exec();
    return (await this.model.findById(id).exec())!;
  }

  /** Мягкое удаление (файл остаётся: на него могут ссылаться выпущенные паспорта). */
  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`ProductPhoto ${id} not found`);
    const current = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (current && importedKind(current.purpose, current.kind)) {
      await this.passportWrite(current.productId, async session => {
        await this.model.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } }, { session }).exec();
      });
      return;
    }
    await this.model.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } }).exec();
  }
}
