import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UI_PREF_KEYS, UI_PREF_STR_KEYS, UiPrefs, User, UserDocument } from './user.schema';
import { userActivityCache } from '../../common/guards/user-activity-cache';
import { isBaseRole, isBuiltinRole } from '../../common/roles-hierarchy';

const BCRYPT_ROUNDS = 10;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMongoDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private readonly model: Model<UserDocument>,
  ) {}

  /**
   * SK-8c: роль сотрудника — встроенная или код существующей активной своей
   * роли (с допустимым baseRole). Коллекцию `roles` читаем напрямую, чтобы
   * user не импортировал role (циклы модулей).
   */
  private async assertRoleAllowed(role: string): Promise<void> {
    if (isBuiltinRole(role)) return;
    const doc = await this.model.db
      .collection('roles')
      .findOne({ name: role }, { projection: { baseRole: 1, isActive: 1 } });
    if (!doc || doc.isActive === false || !isBaseRole(doc.baseRole as string)) {
      throw new BadRequestException(
        'Такой роли нет или она выключена — выберите роль из списка (вкладка «Роли»)',
      );
    }
  }

  async create(dto: CreateUserDto): Promise<UserDocument> {
    await this.assertRoleAllowed(dto.role);
    const username = dto.username.trim().toLowerCase();
    const email = dto.email?.trim().toLowerCase() || undefined;
    const displayName = dto.displayName?.trim() || username;

    const byUsername = await this.findByUsername(username);
    if (byUsername) {
      throw new ConflictException('Логин уже занят');
    }
    if (email) {
      const byEmail = await this.findByEmail(email);
      if (byEmail) {
        throw new ConflictException('Email уже занят');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const doc = await this.model.create({
        username,
        ...(email ? { email } : {}),
        displayName,
        passwordHash,
        role: dto.role,
        permissions: dto.permissions ?? [],
        isActive: dto.isActive ?? true,
        phone: dto.phone,
        fullName: dto.fullName,
      });
      this.logger.log(`User created: ${doc.username}`);
      return doc;
    } catch (err: unknown) {
      if (isMongoDuplicateKey(err)) {
        throw new ConflictException('Логин или email уже заняты');
      }
      throw err;
    }
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ items: UserDocument[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.model
        .find()
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments().exec(),
    ]);
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`User ${id} not found`);
    }
    const doc = await this.model.findById(id).select('-passwordHash').exec();
    if (!doc) throw new NotFoundException(`User ${id} not found`);
    return doc;
  }

  /** С хэшем пароля — только для сверки пароля (подтверждение действий). */
  async findByIdWithHash(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).exec();
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    const escaped = escapeRegex(username.trim());
    if (!escaped) return null;
    return this.model
      .findOne({ username: { $regex: `^${escaped}$`, $options: 'i' } })
      .exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    const escaped = escapeRegex(email.trim());
    if (!escaped) return null;
    return this.model
      .findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } })
      .exec();
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    const doc = await this.findById(id);
    if (dto.role !== undefined && dto.role !== doc.role) await this.assertRoleAllowed(dto.role);

    if (dto.username !== undefined) {
      const username = dto.username.trim().toLowerCase();
      const other = await this.findByUsername(username);
      if (other && String(other._id) !== String(doc._id)) {
        throw new ConflictException('Логин уже занят');
      }
      dto = { ...dto, username };
    }

    if (dto.email !== undefined) {
      const emailRaw = dto.email?.trim() || '';
      if (!emailRaw) {
        dto = { ...dto, email: undefined };
      } else {
        const email = emailRaw.toLowerCase();
        const other = await this.findByEmail(email);
        if (other && String(other._id) !== String(doc._id)) {
          throw new ConflictException('Email уже занят');
        }
        dto = { ...dto, email };
      }
    }

    if (dto.displayName !== undefined) {
      const displayName = dto.displayName?.trim() || doc.username;
      dto = { ...dto, displayName };
    }

    Object.assign(doc, dto);
    try {
      await doc.save();
    } catch (err: unknown) {
      if (isMongoDuplicateKey(err)) {
        throw new ConflictException('Логин или email уже заняты');
      }
      throw err;
    }
    userActivityCache.invalidate(id);
    this.logger.log(`User updated: ${doc.username}`);
    return doc;
  }

  async remove(id: string): Promise<UserDocument> {
    const doc = await this.findById(id);
    await doc.deleteOne();
    this.logger.log(`User soft-deleted: ${doc.username}`);
    return doc;
  }

  async changePassword(
    id: string,
    dto: ChangePasswordDto,
  ): Promise<UserDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`User ${id} not found`);

    const ok = await bcrypt.compare(dto.oldPassword, doc.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Wrong old password');
    }
    doc.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    doc.refreshTokenVersion += 1;
    await doc.save();
    userActivityCache.invalidate(id);
    this.logger.log(`Password changed for user: ${doc.username}`);
    return doc;
  }

  /**
   * TZ-257.A.1 §2 — Administrator password reset.
   *
   * Unlike `changePassword()`, this method does NOT compare an old
   * password: an admin resetting another user's password has no way
   * (and no need) to know the target's current password. It hashes the
   * new password, bumps `refreshTokenVersion` to invalidate all of the
   * target's refresh tokens, and clears the user-activity cache.
   */
  async adminResetPassword(id: string, newPassword: string): Promise<UserDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`User ${id} not found`);

    doc.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    doc.refreshTokenVersion += 1;
    await doc.save();
    userActivityCache.invalidate(id);
    this.logger.log(`Password reset by admin for user: ${doc.username}`);
    return doc;
  }

  async incrementRefreshVersion(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $inc: { refreshTokenVersion: 1 } })
      .exec();
  }

  /**
   * ШП-1 — записать свои настройки интерфейса. `$set` по отдельным ключам
   * `uiPrefs.<ключ>` (не целым объектом): запись с одного ПК не стирает ключи,
   * сохранённые с другого. Пустой набор — ничего не пишет. Возвращает итоговые uiPrefs.
   */
  async setUiPrefs(id: string, prefs: { [K in keyof UiPrefs]?: UiPrefs[K] | null }): Promise<UiPrefs> {
    const $set: Record<string, number | string> = {};
    const $unset: Record<string, ''> = {};
    for (const key of UI_PREF_STR_KEYS) {
      const v = prefs[key];
      if (typeof v === 'string') $set[`uiPrefs.${key}`] = v;
      else if (v === null) $unset[`uiPrefs.${key}`] = '';
    }
    for (const key of UI_PREF_KEYS) {
      const v = prefs[key];
      if (typeof v === 'number') $set[`uiPrefs.${key}`] = v;
      else if (v === null) $unset[`uiPrefs.${key}`] = ''; // сброс к стандарту (двойной щелчок по ручке)
    }
    const update = { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
    const q = Object.keys(update).length
      ? this.model.findOneAndUpdate({ _id: id }, update, { new: true })
      : this.model.findById(id);
    const doc = await q.select('uiPrefs').lean<{ uiPrefs?: UiPrefs } | null>().exec();
    if (!doc) throw new NotFoundException(`User ${id} not found`);
    return doc.uiPrefs ?? {};
  }

  /** Свой профиль: только имя, телефон, аватар. Пустая строка в phone/avatar — очистить. Фото аватара должно существовать. */
  async setProfile(id: string, p: { displayName?: string; phone?: string; avatar?: string }): Promise<void> {
    const $set: Record<string, string> = {};
    const $unset: Record<string, ''> = {};
    if (p.displayName !== undefined) {
      if (!p.displayName.trim()) throw new BadRequestException('Имя не может быть пустым');
      $set.displayName = p.displayName.trim();
    }
    for (const k of ['phone', 'avatar'] as const) {
      const v = p[k];
      if (v === undefined) continue;
      if (v.trim() === '') $unset[k] = ''; else $set[k] = v.trim();
    }
    if (p.avatar?.startsWith('photo:')) {
      const photo = await this.model.db.collection('photos').findOne({ _id: new Types.ObjectId(p.avatar.slice(6)), deletedAt: null }, { projection: { _id: 1 } });
      if (!photo) throw new BadRequestException('Фото для аватара не найдено');
    }
    const update = { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
    if (!Object.keys(update).length) return;
    await this.model.updateOne({ _id: id }, update).exec();
    userActivityCache.invalidate(id);
  }

  async verifyPassword(user: UserDocument, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.passwordHash);
  }

  async count(): Promise<number> {
    return this.model.countDocuments().exec();
  }
}
