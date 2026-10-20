import {
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
import { User, UserDocument } from './user.schema';
import { userActivityCache } from '../../common/guards/user-activity-cache';

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

  async create(dto: CreateUserDto): Promise<UserDocument> {
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

  async verifyPassword(user: UserDocument, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.passwordHash);
  }

  async count(): Promise<number> {
    return this.model.countDocuments().exec();
  }
}
