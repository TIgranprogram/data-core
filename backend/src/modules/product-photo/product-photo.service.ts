import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductPhoto, ProductPhotoDocument } from './product-photo.schema';

export interface UpsertProductPhotoDto {
  productId: string;
  photoId?: string;
  url?: string;
  caption?: string;
  isMain?: boolean;
  sortOrder?: number;
}

@Injectable()
export class ProductPhotoService {
  constructor(
    @InjectModel(ProductPhoto.name) private readonly model: Model<ProductPhotoDocument>,
  ) {}

  async upsert(dto: UpsertProductPhotoDto): Promise<ProductPhotoDocument> {
    if (dto.isMain) {
      // demote other mains for this product
      await this.model.updateMany(
        { productId: new Types.ObjectId(dto.productId) },
        { $set: { isMain: false } },
      ).exec();
    }
    return this.model.create({
      productId: new Types.ObjectId(dto.productId),
      photoId: dto.photoId ? new Types.ObjectId(dto.photoId) : undefined,
      url: dto.url,
      caption: dto.caption,
      isMain: dto.isMain ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });
  }

  async findByProduct(productId: string): Promise<ProductPhotoDocument[]> {
    return this.model
      .find({ productId: new Types.ObjectId(productId) })
      .populate('photoId')
      .sort({ isMain: -1, sortOrder: 1 })
      .exec();
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`ProductPhoto ${id} not found`);
    await this.model.deleteOne({ _id: id }).exec();
  }
}
