import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  CreateImportTodoDto,
  PatchImportTodoDto,
} from './dto/create-import-todo.dto';
import {
  ImportTodo,
  ImportTodoDocument,
  ImportTodoStatus,
} from './import-todo.schema';

@Injectable()
export class ImportTodoService {
  constructor(
    @InjectModel(ImportTodo.name)
    private readonly model: Model<ImportTodoDocument>,
  ) {}

  /** TZD-29 — создать todo менеджеру (агент через MCP или веб). */
  async create(dto: CreateImportTodoDto, user: AuthenticatedUser) {
    this.requireUser(user);
    const orgId =
      user.organizationId && Types.ObjectId.isValid(user.organizationId)
        ? new Types.ObjectId(user.organizationId)
        : undefined;

    const doc = await this.model.create({
      title: dto.title.trim(),
      ...(dto.body?.trim() ? { body: dto.body.trim() } : {}),
      ...(dto.href?.trim() ? { href: dto.href.trim() } : {}),
      ...(dto.importTaskId && Types.ObjectId.isValid(dto.importTaskId)
        ? { importTaskId: new Types.ObjectId(dto.importTaskId) }
        : {}),
      ...(dto.templateId && Types.ObjectId.isValid(dto.templateId)
        ? { templateId: new Types.ObjectId(dto.templateId) }
        : {}),
      organizationId: orgId,
      createdByUserId: new Types.ObjectId(user.id),
      status: 'open' as ImportTodoStatus,
    });
    return this.toView(doc);
  }

  async list(
    user: AuthenticatedUser,
    opts: { status?: string; page?: number; limit?: number } = {},
  ) {
    this.requireUser(user);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const filter = this.orgFilter(user);
    if (opts.status === 'open' || opts.status === 'done') {
      (filter as Record<string, unknown>).status = opts.status;
    }

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((d) => this.toView(d as ImportTodoDocument)),
      total,
      page,
      limit,
    };
  }

  /** TZD-29 — закрыть/открыть todo (PATCH { status }). Не silent auto-close. */
  async patchStatus(
    id: string,
    dto: PatchImportTodoDto,
    user: AuthenticatedUser,
  ) {
    const doc = await this.findScoped(id, user);
    doc.status = dto.status;
    await doc.save();
    return this.toView(doc);
  }

  private requireUser(user: AuthenticatedUser) {
    if (!user?.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }
  }

  private orgFilter(user: AuthenticatedUser): Record<string, unknown> {
    if (user.organizationId && Types.ObjectId.isValid(user.organizationId)) {
      return { organizationId: new Types.ObjectId(user.organizationId) };
    }
    return { createdByUserId: new Types.ObjectId(user.id) };
  }

  private async findScoped(id: string, user: AuthenticatedUser) {
    this.requireUser(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid import todo id');
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('Import todo not found');

    const filter = this.orgFilter(user);
    if (filter.organizationId) {
      if (
        !doc.organizationId ||
        doc.organizationId.toString() !==
          (filter.organizationId as Types.ObjectId).toString()
      ) {
        throw new NotFoundException('Import todo not found');
      }
    } else if (doc.createdByUserId.toString() !== user.id) {
      throw new NotFoundException('Import todo not found');
    }
    return doc;
  }

  private toView(doc: ImportTodoDocument | Record<string, any>) {
    const d: any =
      typeof (doc as any).toObject === 'function'
        ? (doc as any).toObject()
        : doc;
    return {
      id: String(d._id),
      title: d.title,
      body: d.body ?? null,
      href: d.href ?? null,
      importTaskId: d.importTaskId ? String(d.importTaskId) : null,
      templateId: d.templateId ? String(d.templateId) : null,
      organizationId: d.organizationId ? String(d.organizationId) : null,
      createdByUserId: d.createdByUserId ? String(d.createdByUserId) : null,
      status: d.status,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    };
  }
}
