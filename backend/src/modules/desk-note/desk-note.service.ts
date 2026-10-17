import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateDeskNoteDto,
  UpdateDeskNoteDto,
} from './dto/desk-note.dto';
import { DeskNote, DeskNoteDocument } from './desk-note.schema';

export interface DeskNoteListFilters {
  orderId?: string;
  lineId?: string;
  moduleId?: string;
}

export interface DeskNoteActor {
  id: string;
  role: string;
}

const PRIVILEGED_ROLES = new Set(['admin', 'director', 'manager']);

/**
 * TZ-DESK-408 — CRUD заметок стола. Один write-path; hard delete (PO: compact).
 * TZ-DESK-415 — list только с валидным orderId; PATCH/DELETE — автор или privileged.
 */
@Injectable()
export class DeskNoteService {
  constructor(
    @InjectModel(DeskNote.name)
    private readonly model: Model<DeskNoteDocument>,
  ) {}

  async findAll(filters: DeskNoteListFilters): Promise<DeskNoteDocument[]> {
    const orderId = filters.orderId?.trim();
    if (!orderId || !Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('orderId is required');
    }
    const q: Record<string, unknown> = {
      anchorOrderId: new Types.ObjectId(orderId),
    };
    if (filters.lineId?.trim()) {
      q.anchorLineId = filters.lineId.trim();
    }
    if (filters.moduleId && Types.ObjectId.isValid(filters.moduleId)) {
      q.anchorModuleId = new Types.ObjectId(filters.moduleId);
    }
    return this.model.find(q).sort({ createdAt: -1 }).limit(200).exec();
  }

  async create(
    dto: CreateDeskNoteDto,
    authorId: string,
  ): Promise<DeskNoteDocument> {
    if (!Types.ObjectId.isValid(dto.anchorOrderId)) {
      throw new BadRequestException('Invalid anchorOrderId');
    }
    if (dto.anchorModuleId && !Types.ObjectId.isValid(dto.anchorModuleId)) {
      throw new BadRequestException('Invalid anchorModuleId');
    }
    if (!Types.ObjectId.isValid(authorId)) {
      throw new BadRequestException('Invalid authorId');
    }
    return this.model.create({
      text: dto.text.trim(),
      kind: dto.kind ?? 'note',
      anchorOrderId: new Types.ObjectId(dto.anchorOrderId),
      anchorLineId: dto.anchorLineId?.trim() || undefined,
      anchorModuleId: dto.anchorModuleId
        ? new Types.ObjectId(dto.anchorModuleId)
        : undefined,
      authorId: new Types.ObjectId(authorId),
      isDone: false,
    });
  }

  async update(
    id: string,
    dto: UpdateDeskNoteDto,
    actor: DeskNoteActor,
  ): Promise<DeskNoteDocument> {
    const doc = await this.findById(id);
    this.assertCanMutate(doc, actor);
    if (dto.text !== undefined) doc.text = dto.text.trim();
    if (dto.kind !== undefined) doc.kind = dto.kind;
    if (dto.isDone !== undefined) doc.isDone = dto.isDone;
    return doc.save();
  }

  async remove(id: string, actor: DeskNoteActor): Promise<void> {
    const doc = await this.findById(id);
    this.assertCanMutate(doc, actor);
    const res = await this.model.deleteOne({ _id: doc._id }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException(`DeskNote ${id} not found`);
    }
  }

  private assertCanMutate(note: DeskNoteDocument, actor: DeskNoteActor): void {
    if (String(note.authorId) === actor.id) return;
    if (PRIVILEGED_ROLES.has(actor.role)) return;
    throw new ForbiddenException('Not your desk note');
  }

  private async findById(id: string): Promise<DeskNoteDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`DeskNote ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`DeskNote ${id} not found`);
    return doc;
  }
}
