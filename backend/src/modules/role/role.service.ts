import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role, RoleDocument } from './role.schema';
import { userActivityCache } from '../../common/guards/user-activity-cache';
import {
  isBaseRole,
  isBuiltinRole,
  setCustomRoleBase,
  setCustomRoleBases,
} from '../../common/roles-hierarchy';

/** «1 сотруднику», «2 сотрудникам», «11 сотрудникам». */
const employeesDative = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'сотруднику' : 'сотрудникам'}`;

@Injectable()
export class RoleService implements OnModuleInit {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectModel(Role.name) private readonly model: Model<RoleDocument>,
  ) {}

  /** SK-8c: кэш «своя роль → baseRole» (common/roles-hierarchy.ts) — при старте. */
  async onModuleInit(): Promise<void> {
    await this.reloadRoleBases();
  }

  async reloadRoleBases(): Promise<void> {
    const list = await this.model
      .find({ baseRole: { $exists: true, $ne: null } }, { name: 1, baseRole: 1 })
      .lean()
      .exec();
    setCustomRoleBases(list as Array<{ name: string; baseRole?: string }>);
  }

  /** Создание с заданным кодом (сиды, /api/admin/roles владельца). */
  async create(dto: CreateRoleDto): Promise<RoleDocument> {
    if (!dto.name) throw new BadRequestException('Не указан код роли');
    if (dto.baseRole && isBuiltinRole(dto.name)) {
      throw new BadRequestException('У встроенной роли «Права как у» не задаётся');
    }
    const existing = await this.model.findOne({ name: dto.name }).exec();
    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists`);
    }
    const doc = await this.model.create({
      ...dto,
      permissions: dto.permissions ?? [],
      sortOrder: dto.sortOrder ?? 100,
      isActive: dto.isActive ?? true,
    });
    setCustomRoleBase(doc.name, doc.baseRole);
    this.logger.log(`Role created: ${doc.name}`);
    return doc;
  }

  /**
   * SK-8c: «Новая роль» из админки (POST /api/roles). Код `r-…` задаёт сервер,
   * права — от baseRole (свои permissions не берутся), не системная.
   */
  async createCustom(dto: CreateRoleDto): Promise<RoleDocument> {
    if (dto.name !== undefined) {
      throw new BadRequestException('Код роли задаёт сервер — укажите только название');
    }
    if (!dto.baseRole || !isBaseRole(dto.baseRole)) {
      throw new BadRequestException('Выберите «Права как у»: наблюдатель, менеджер, бухгалтер или директор');
    }
    let name = '';
    for (let i = 0; i < 5 && !name; i++) {
      const candidate = 'r-' + randomBytes(3).toString('hex');
      if (!(await this.model.exists({ name: candidate }))) name = candidate;
    }
    if (!name) throw new ConflictException('Не удалось подобрать код роли — повторите');
    return this.create({
      ...dto,
      name,
      label: dto.label.trim(),
      permissions: [],
      isSystem: false,
    });
  }

  async findAll(): Promise<RoleDocument[]> {
    return this.model.find().sort({ sortOrder: 1, name: 1 }).exec();
  }

  async findById(id: string): Promise<RoleDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Role ${id} not found`);
    return doc;
  }

  async findByName(name: string): Promise<RoleDocument | null> {
    return this.model.findOne({ name }).exec();
  }

  /**
   * SK-8c: роль пользователя для входа и req.user. `role` — сама роль
   * (название, разделы меню); `access` — откуда брать права (permissions,
   * pages): у своей роли — её baseRole, у остальных — она сама.
   */
  async resolveForAuth(
    name: string,
  ): Promise<{ role: RoleDocument | null; access: RoleDocument | null; baseRole: string }> {
    const role = await this.findByName(name);
    const base = role?.baseRole && !isBuiltinRole(name) && isBaseRole(role.baseRole) ? role.baseRole : null;
    if (role) setCustomRoleBase(role.name, base);
    if (!base) return { role, access: role, baseRole: name };
    return { role, access: await this.findByName(base), baseRole: base };
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined && dto.name !== doc.name) {
      throw new BadRequestException('Код роли менять нельзя — меняйте название');
    }
    const builtin = isBuiltinRole(doc.name) || doc.isSystem === true;
    if (dto.baseRole !== undefined && builtin && dto.baseRole !== doc.baseRole) {
      throw new BadRequestException('У встроенной роли «Права как у» не меняется');
    }
    // Встроенную роль нельзя выключить и нельзя менять её права/системность: иначе один запрос оставит без входа всех админов
    // или выдаст менеджеру всё (замечание архитектора 2026-10-24). Название и разделы — можно.
    const d = dto as UpdateRoleDto & { isActive?: boolean; isSystem?: boolean; permissions?: string[] };
    const samePerms = (a?: string[], b?: string[]) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
    if (builtin && (d.isActive === false || (d.isSystem !== undefined && d.isSystem !== doc.isSystem) || (d.permissions !== undefined && !samePerms(d.permissions, doc.permissions)))) {
      throw new BadRequestException('У встроенной роли можно менять только название и разделы');
    }
    if (!builtin && doc.baseRole && 'baseRole' in dto && !dto.baseRole) {
      throw new BadRequestException('У своей роли «Права как у» обязательно');
    }
    Object.assign(doc, dto);
    if (typeof dto.label === 'string') doc.label = dto.label.trim();
    await doc.save();
    setCustomRoleBase(doc.name, doc.baseRole);
    userActivityCache.invalidateAll();
    this.logger.log(`Role updated: ${doc.name}`);
    return doc;
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (doc.isSystem || isBuiltinRole(doc.name)) {
      throw new ConflictException(`Встроенную роль «${doc.label || doc.name}» удалить нельзя`);
    }
    const assigned = await this.model.db.collection('users').countDocuments({ role: doc.name });
    if (assigned > 0) {
      throw new ConflictException(
        `Роль назначена ${employeesDative(assigned)} — сначала смените им роль`,
      );
    }
    await doc.deleteOne();
    setCustomRoleBase(doc.name, null);
    userActivityCache.invalidateAll();
    this.logger.log(`Role deleted: ${doc.name}`);
  }
}
