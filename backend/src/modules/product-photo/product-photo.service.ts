import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

@Injectable()
export class ProductPhotoService {
  constructor(
    @InjectModel(ProductPhoto.name) private readonly model: Model<ProductPhotoDocument>,
  ) {}

  async upsert(dto: UpsertProductPhotoDto): Promise<ProductPhotoDocument> {
    checkPurposeKind(dto.purpose, dto.kind);
    const productId = new Types.ObjectId(dto.productId);
    const purpose = dto.purpose && dto.purpose !== 'showcase' ? dto.purpose : undefined;
    if (dto.isMain && !purpose) {
      // главное — только среди витринных фото; рисунки паспорта главными не бывают
      await this.model.updateMany({ productId, ...purposeFilter() }, { $set: { isMain: false } }).exec();
    }
    return this.model.create({
      productId,
      photoId: dto.photoId ? new Types.ObjectId(dto.photoId) : undefined,
      url: dto.url,
      caption: dto.caption,
      isMain: purpose ? false : dto.isMain ?? false,
      sortOrder: dto.sortOrder ?? 0,
      ...(purpose ? { purpose } : {}),
      ...(dto.kind ? { kind: dto.kind } : {}),
    });
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
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
    return (await this.model.findById(id).exec())!;
  }

  /** Мягкое удаление (файл остаётся: на него могут ссылаться выпущенные паспорта). */
  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`ProductPhoto ${id} not found`);
    await this.model.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } }).exec();
  }
}
