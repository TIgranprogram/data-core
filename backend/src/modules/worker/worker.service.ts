import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Worker, WorkerDocument } from './worker.schema';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { FindWorkersDto } from './dto/find-workers.dto';
import { WorkType } from '../work-type/work-type.schema';
import { Organization } from '../organization/organization.schema';
import { User } from '../user/user.schema';

export interface WorkerListResult {
  items: WorkerDocument[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * TZ-WORKERS-301 — WorkerService (единая сущность «Люди»).
 *
 * - `create`/`update` soft-validates FK: workTypeIds → WorkType,
 *   supplierId → Organization (тип supplier), managerOfSupplierIds →
 *   Organization, userId → User. Битые ссылки → 404.
 * - IDOR guard: organizationId ВСЕГДА передаётся из контроллера
 *   (req.user), не из DTO. update/remove отказывают (403) при попытке
 *   изменить запись чужой области.
 * - `findAll` возвращает envelope { items, total, page, limit } с
 *   org-scope $or (своя область + системные + legacy без области) —
 *   counterparty-паттерн.
 * - Soft delete: remove() ставит deletedAt (как было), findById/findAll
 *   исключают удалённые.
 * - Email нормализуется в нижний регистр; коллизия {organizationId,
 *   email} (sparse-unique индекс) превращается в 409 Conflict.
 */
@Injectable()
export class WorkerService {
  constructor(
    @InjectModel(Worker.name)
    private readonly model: Model<WorkerDocument>,
    @InjectModel(WorkType.name)
    private readonly workTypeModel: Model<WorkType>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<Organization>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  private toObjectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private normalizeEmail(email?: string | null): string | undefined {
    // null/'' → undefined (поле можно очистить через null; пустая строка
    // не проходит @IsEmail и отвергается раньше). Никогда не trim(null).
    if (email == null) return undefined;
    return email.trim().toLowerCase() || undefined;
  }

  /**
   * Детерминированный pre-check email-уникальности в области (TZ-DOC-315
   * паттерн: явный конфликт-чек + sparse-unique индекс как бэкстоп).
   * organizationId === null/undefined → глобальная уникальность (системные
   * записи). 409 при коллизии.
   */
  private async assertEmailFree(
    email: string | undefined,
    organizationId?: string | null,
    excludeId?: Types.ObjectId,
  ): Promise<void> {
    if (!email) return;
    const filter: Record<string, unknown> = {
      email,
      // null матчит и отсутствующий organizationId (legacy/системные записи)
      organizationId: organizationId ? new Types.ObjectId(organizationId) : null,
    };
    if (excludeId) filter._id = { $ne: excludeId };
    const existing = await this.model.findOne(filter).select('_id').exec();
    if (existing) {
      throw new ConflictException(
        'Worker with this email already exists in the organization scope',
      );
    }
  }

  /**
   * Soft-валидация FK-ссылок из DTO. Бросает 404 на несуществующие ref.
   * supplierId дополнительно проверяется: фирма должна иметь тип supplier.
   */
  private async assertRefsExist(dto: CreateWorkerDto | UpdateWorkerDto): Promise<void> {
    if (dto.workTypeIds?.length) {
      const ids = dto.workTypeIds.map((id) => this.toObjectId(id, 'workTypeIds'));
      const count = await this.workTypeModel
        .countDocuments({ _id: { $in: ids } })
        .exec();
      if (count !== ids.length) {
        throw new NotFoundException('One or more workTypeIds not found');
      }
    }

    if (dto.supplierId) {
      const id = this.toObjectId(dto.supplierId, 'supplierId');
      const org = await this.orgModel.findById(id).select('type').exec();
      if (!org) {
        throw new NotFoundException(`Supplier organization ${dto.supplierId} not found`);
      }
      if (!Array.isArray(org.type) || !org.type.includes('supplier')) {
        throw new BadRequestException(
          `Organization ${dto.supplierId} is not a supplier`,
        );
      }
    }

    if (dto.managerOfSupplierIds?.length) {
      const ids = dto.managerOfSupplierIds.map((id) =>
        this.toObjectId(id, 'managerOfSupplierIds'),
      );
      const count = await this.orgModel
        .countDocuments({ _id: { $in: ids } })
        .exec();
      if (count !== ids.length) {
        throw new NotFoundException('One or more managerOfSupplierIds not found');
      }
    }

    if (dto.userId) {
      const id = this.toObjectId(dto.userId, 'userId');
      const user = await this.userModel.findById(id).select('_id').exec();
      if (!user) {
        throw new NotFoundException(`User ${dto.userId} not found`);
      }
    }
  }

  private toObjectIdArray(values?: string[]): Types.ObjectId[] {
    return (values ?? []).map((id) => this.toObjectId(id, 'objectIds'));
  }

  async create(
    dto: CreateWorkerDto,
    organizationId?: string | null,
  ): Promise<WorkerDocument> {
    await this.assertRefsExist(dto);
    const email = this.normalizeEmail(dto.email);
    await this.assertEmailFree(email, organizationId);
    try {
      return await this.model.create({
        lastName: dto.lastName,
        firstName: dto.firstName,
        patronymic: dto.patronymic,
        grade: dto.grade,
        phone: dto.phone,
        department: dto.department,
        ratePerHour: dto.ratePerHour ?? 0,
        workTypeIds: this.toObjectIdArray(dto.workTypeIds),
        isActive: dto.isActive ?? true,
        personId: dto.personId
          ? this.toObjectId(dto.personId, 'personId')
          : undefined,
        email,
        position: dto.position,
        supplierId: dto.supplierId
          ? this.toObjectId(dto.supplierId, 'supplierId')
          : undefined,
        managerOfSupplierIds: this.toObjectIdArray(dto.managerOfSupplierIds),
        userId: dto.userId ? this.toObjectId(dto.userId, 'userId') : undefined,
        organizationId: organizationId
          ? new Types.ObjectId(organizationId)
          : undefined,
        notes: dto.notes,
        isSystem: dto.isSystem ?? false,
      });
    } catch (err) {
      this.throwIfDuplicateEmail(err);
      throw err;
    }
  }

  async findAll(
    query: FindWorkersDto = {},
    organizationId?: string | null,
  ): Promise<WorkerListResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const filter: Record<string, unknown> = { deletedAt: null };

    if (organizationId) {
      filter.$or = [
        { organizationId: new Types.ObjectId(organizationId) },
        { organizationId: null, isSystem: true },
        { organizationId: { $exists: false } },
      ];
    }

    if (typeof query.isActive === 'boolean') filter.isActive = query.isActive;
    if (query.supplierId) {
      filter.supplierId = this.toObjectId(query.supplierId, 'supplierId');
    }
    if (query.workTypeId) {
      filter.workTypeIds = this.toObjectId(query.workTypeId, 'workTypeId');
    }

    if (query.search) {
      const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(safe, 'i');
      const searchCond = {
        $or: [
          { lastName: re },
          { firstName: re },
          { email: re },
          { phone: re },
        ],
      };
      if (filter.$or) {
        filter.$or = (filter.$or as Record<string, unknown>[]).map((cond) => ({
          ...cond,
          ...searchCond,
        }));
      } else {
        filter.$or = [searchCond];
      }
    }

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findById(
    id: string,
    organizationId?: string | null,
  ): Promise<WorkerDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Worker ${id} not found`);
    }
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException(`Worker ${id} not found`);
    // P1-fix (review): одиночное чтение тоже org-scoped — не светим
    // записи чужой области даже по известному ID.
    this.assertSameScope(doc, organizationId);
    return doc;
  }

  /**
   * IDOR guard: запись чужой области недоступна. Legacy-записи БЕЗ
   * organizationId (видимые через $exists:false ветку scope) разрешены
   * к чтению/мутации — counterparty-конвенция.
   */
  private assertSameScope(doc: WorkerDocument, organizationId?: string | null): void {
    if (!organizationId) return; // системный вызов без области
    if (doc.organizationId && String(doc.organizationId) !== organizationId) {
      throw new ForbiddenException(
        'Worker belongs to another organization scope',
      );
    }
  }

  async update(
    id: string,
    dto: UpdateWorkerDto,
    organizationId?: string | null,
  ): Promise<WorkerDocument> {
    const doc = await this.findById(id, organizationId);
    await this.assertRefsExist(dto);

    if (dto.lastName !== undefined) doc.lastName = dto.lastName;
    if (dto.firstName !== undefined) doc.firstName = dto.firstName;
    if (dto.patronymic !== undefined) doc.patronymic = dto.patronymic;
    if (dto.grade !== undefined) doc.grade = dto.grade;
    if (dto.ratePerHour !== undefined) doc.ratePerHour = dto.ratePerHour;
    if (dto.workTypeIds !== undefined) {
      doc.workTypeIds = this.toObjectIdArray(dto.workTypeIds);
    }
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.phone !== undefined) doc.phone = dto.phone;
    if (dto.personId !== undefined) {
      doc.personId = dto.personId
        ? this.toObjectId(dto.personId, 'personId')
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.department !== undefined) doc.department = dto.department;

    if (dto.email !== undefined) {
      const newEmail = this.normalizeEmail(dto.email);
      await this.assertEmailFree(newEmail, organizationId, doc._id);
      doc.email = newEmail;
    }
    if (dto.position !== undefined) doc.position = dto.position;
    if (dto.supplierId !== undefined) {
      doc.supplierId = dto.supplierId
        ? this.toObjectId(dto.supplierId, 'supplierId')
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.managerOfSupplierIds !== undefined) {
      doc.managerOfSupplierIds = this.toObjectIdArray(dto.managerOfSupplierIds);
    }
    if (dto.userId !== undefined) {
      doc.userId = dto.userId
        ? this.toObjectId(dto.userId, 'userId')
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.isSystem !== undefined) doc.isSystem = dto.isSystem;

    try {
      return await doc.save();
    } catch (err) {
      this.throwIfDuplicateEmail(err);
      throw err;
    }
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id, organizationId);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }

  private throwIfDuplicateEmail(err: unknown): void {
    const code = (err as { code?: number } | undefined)?.code;
    if (code === 11000) {
      throw new ConflictException(
        'Worker with this email already exists in the organization scope',
      );
    }
  }
}
