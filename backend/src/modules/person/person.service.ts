import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { Person, PersonDocument } from './person.schema';

export interface PersonQuery {
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class PersonService {
  private readonly logger = new Logger(PersonService.name);

  constructor(
    @InjectModel(Person.name) private readonly model: Model<PersonDocument>,
  ) {}

  async create(dto: CreatePersonDto): Promise<PersonDocument> {
    return this.model.create(dto);
  }

  async findAll(q: PersonQuery = {}): Promise<{ items: PersonDocument[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const filter: Record<string, unknown> = {};
    if (q.search) {
      const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      filter.$or = [{ lastName: re }, { firstName: re }, { patronymic: re }, { email: re }, { phone: re }];
    }
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ lastName: 1, firstName: 1 }).skip((page - 1) * limit).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<PersonDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Person ${id} not found`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Person ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdatePersonDto): Promise<PersonDocument> {
    const doc = await this.findById(id);
    Object.assign(doc, dto);
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
    this.logger.log(`Person soft-deleted: ${id}`);
  }
}
