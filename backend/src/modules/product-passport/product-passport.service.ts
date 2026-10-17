import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductPassport, ProductPassportDocument } from './product-passport.schema';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';

@Injectable()
export class ProductPassportService {
  constructor(
    @InjectModel(ProductPassport.name)
    private readonly model: Model<ProductPassportDocument>,
  ) {}

  async create(dto: CreateProductPassportDto): Promise<ProductPassportDocument> {
    return this.model.create({
      ...dto,
      productId: new Types.ObjectId(dto.productId),
      date: dto.date ? new Date(dto.date) : undefined,
    });
  }

  async findByProductId(productId: string): Promise<ProductPassportDocument> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException(`ProductPassport for product ${productId} not found`);
    }
    const doc = await this.model.findOne({ productId: new Types.ObjectId(productId) }).exec();
    if (!doc) {
      throw new NotFoundException(`ProductPassport for product ${productId} not found`);
    }
    return doc;
  }

  async findAll(productId?: string): Promise<ProductPassportDocument[]> {
    const filter: Record<string, unknown> = {};
    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      filter.productId = new Types.ObjectId(productId);
    }
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<ProductPassportDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ProductPassport ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`ProductPassport ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateProductPassportDto): Promise<ProductPassportDocument> {
    const doc = await this.findById(id);
    if (dto.passportNumber !== undefined) doc.passportNumber = dto.passportNumber;
    if (dto.productCode !== undefined) doc.productCode = dto.productCode;
    if (dto.warrantyCode !== undefined) doc.warrantyCode = dto.warrantyCode;
    if (dto.date !== undefined) doc.date = new Date(dto.date);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.category !== undefined) doc.category = dto.category;
    if (dto.article !== undefined) doc.article = dto.article;
    if (dto.height !== undefined) doc.height = dto.height;
    if (dto.length !== undefined) doc.length = dto.length;
    if (dto.width !== undefined) doc.width = dto.width;
    if (dto.weight !== undefined) doc.weight = dto.weight;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.installationSite !== undefined) doc.installationSite = dto.installationSite;
    if (dto.supplier !== undefined) doc.supplier = dto.supplier;
    if (dto.photo !== undefined) doc.photo = dto.photo;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
