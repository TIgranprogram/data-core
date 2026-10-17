import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './comment.schema';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentService {
  constructor(
    @InjectModel(Comment.name)
    private readonly model: Model<CommentDocument>,
  ) {}

  async create(dto: CreateCommentDto, authorId: string, author?: string): Promise<CommentDocument> {
    return this.model.create({
      packageTag: dto.packageTag,
      text: dto.text,
      authorId: new Types.ObjectId(authorId),
      author,
      isArchived: false,
    });
  }

  async findAll(packageTag?: string, isArchived?: boolean): Promise<CommentDocument[]> {
    const filter: Record<string, unknown> = {};
    if (packageTag) filter.packageTag = packageTag;
    if (typeof isArchived === 'boolean') filter.isArchived = isArchived;
    return this.model
      .find(filter)
      .populate('authorId', 'email name')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<CommentDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Comment ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('authorId', 'email name').exec();
    if (!doc) throw new NotFoundException(`Comment ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateCommentDto, requesterId: string, isAdmin: boolean): Promise<CommentDocument> {
    const doc = await this.findById(id);
    if (!isAdmin && doc.authorId.toString() !== requesterId) {
      throw new NotFoundException(`Not allowed to update this comment`);
    }
    doc.text = dto.text;
    return doc.save();
  }

  async archive(id: string): Promise<CommentDocument> {
    const doc = await this.findById(id);
    doc.isArchived = true;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }
}
