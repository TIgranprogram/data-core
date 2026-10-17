import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { User, UserDocument } from '../user/user.schema';
import { Role, RoleDocument } from '../role/role.schema';
import { AuditService } from '../audit/audit.service';
import { DeviceInvite, DeviceInviteDocument } from './device-invite.schema';
import {
  BrowserDeviceGrant,
  BrowserDeviceGrantDocument,
} from './browser-device-grant.schema';
import { sha256Hex, randomSecret, secretPrefix } from './device-crypto';
import { CreateRegularInviteDto, CreateOwnerInviteDto } from './dto/create-invite.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

const GENERIC_INVITE_ERROR = 'Приглашение недействительно или истекло';

const BCRYPT_ROUNDS = 10;
const DEVICE_USERNAME_PREFIX = 'device_';

export interface IssuedInvite {
  inviteId: string;
  url: string;
  secret: string;
  expiresAt: Date;
  kind: 'regular' | 'owner-device';
  role?: string;
}

export interface ConsumedDevice {
  access: string;
  grantSecret: string;
  deviceName: string;
  role: string;
  expiresAt: Date;
  isOwner: boolean;
  /**
   * TZ-AUTH-303/304 — explicit session marker so the SPA never mixes a
   * device session (cookie-renew) with a password session (refresh-token
   * renew). Always 'device' for enroll/session responses.
   */
  sessionKind: 'device';
}

export interface DeviceStatus {
  status: 'active' | 'revoked' | 'expired';
  deviceName?: string;
}

@Injectable()
export class DeviceEnrollmentService {
  private readonly logger = new Logger(DeviceEnrollmentService.name);

  constructor(
    @InjectModel(DeviceInvite.name)
    private readonly inviteModel: Model<DeviceInviteDocument>,
    @InjectModel(BrowserDeviceGrant.name)
    private readonly grantModel: Model<BrowserDeviceGrantDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- invites

  async issueRegularInvite(
    actor: { id: string; isOwner?: boolean },
    dto: CreateRegularInviteDto,
  ): Promise<IssuedInvite> {
    const roleName = dto.role?.trim();
    if (!roleName) {
      throw new NotFoundException('Выберите существующую активную роль');
    }
    // TZ-AUTH-306 — granting administrator power is owner-only. An ordinary
    // admin cannot mint a device invite that yields an `admin` account.
    if (roleName === 'admin' && actor.isOwner !== true) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Only the system owner can create administrator device invites',
      });
    }
    const role = await this.roleModel.findOne({ name: roleName }).lean().exec();
    if (!role || role.isActive === false) {
      throw new NotFoundException('Выберите существующую активную роль');
    }

    const ttlDays = dto.ttlDays ?? this.config.get<number>('device.inviteTtlDays') ?? 3;
    const deviceTtlDays =
      dto.deviceTtlDays ?? this.config.get<number>('device.grantTtlDays') ?? 365;
    const secret = randomSecret(
      this.config.get<number>('device.inviteSecretBytes') ?? 32,
    );
    const invite = await this.inviteModel.create({
      secretHash: sha256Hex(secret),
      secretPrefix: secretPrefix(secret),
      kind: 'regular',
      role: roleName,
      createdBy: new Types.ObjectId(actor.id),
      deviceTtlDays,
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    });

    this.logger.log(
      `Regular device invite created by=${actor.id} role=${roleName} ttlDays=${ttlDays}`,
    );
    await this.audit.log({
      action: 'device.invite.created',
      entityType: 'DeviceInvite',
      entityId: invite._id,
      details: { after: { kind: 'regular', role: roleName, deviceTtlDays } },
      userId: actor.id,
    });

    return {
      inviteId: String(invite._id),
      url: this.buildInviteUrl(secret),
      secret,
      expiresAt: invite.expiresAt,
      kind: 'regular',
      role: roleName,
    };
  }

  async issueOwnerInvite(
    actor: { id: string; isOwner?: boolean },
    dto: CreateOwnerInviteDto,
  ): Promise<IssuedInvite> {
    if (actor.isOwner !== true) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'This action is available only to the system owner',
      });
    }

    // Password step-up: re-confirm the owner's own password (break-glass).
    const owner = await this.userModel.findById(actor.id).exec();
    if (!owner || !owner.isActive || owner.isOwner !== true) {
      throw new UnauthorizedException('Owner not found or inactive');
    }
    const ok = await bcrypt.compare(dto.password ?? '', owner.passwordHash);
    if (!ok) {
      this.logger.warn(`owner_invite_stepup_failed userId=${owner.id}`);
      throw new UnauthorizedException('Неверный пароль');
    }

    const ttlMinutes =
      this.config.get<number>('device.ownerInviteTtlMinutes') ?? 15;
    const deviceTtlDays =
      this.config.get<number>('device.grantTtlDays') ?? 365;
    const secret = randomSecret(
      this.config.get<number>('device.inviteSecretBytes') ?? 32,
    );
    const invite = await this.inviteModel.create({
      secretHash: sha256Hex(secret),
      secretPrefix: secretPrefix(secret),
      kind: 'owner-device',
      ownerUserId: owner._id,
      createdBy: owner._id,
      deviceTtlDays,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });

    this.logger.log(`Owner-device invite created by=${owner.id}`);
    await this.audit.log({
      action: 'device.invite.created',
      entityType: 'DeviceInvite',
      entityId: invite._id,
      details: { after: { kind: 'owner-device', deviceTtlDays } },
      userId: owner.id,
    });

    return {
      inviteId: String(invite._id),
      url: this.buildInviteUrl(secret),
      secret,
      expiresAt: invite.expiresAt,
      kind: 'owner-device',
    };
  }

  // -------------------------------------------------------------- activation

  async consumeInvite(
    rawSecret: string,
    deviceName: string,
    ip?: string,
  ): Promise<ConsumedDevice> {
    const secret = String(rawSecret ?? '').trim();
    const secretHash = sha256Hex(secret);
    const invite = await this.inviteModel.findOne({ secretHash }).exec();
    if (!invite) {
      throw new GoneException(GENERIC_INVITE_ERROR);
    }
    if (invite.consumedAt) {
      // One-time: a repeat consumption is a 409, distinguishable from expiry.
      throw new ConflictException('Приглашение уже использовано');
    }
    if (invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(GENERIC_INVITE_ERROR);
    }

    const cleanName = deviceName.trim().slice(0, 80);
    if (!cleanName) {
      throw new GoneException(GENERIC_INVITE_ERROR);
    }

    // Grant secret is generated here (not the invite secret) — the browser
    // receives a fresh, independent 365d credential.
    const grantSecret = randomSecret(
      this.config.get<number>('device.grantSecretBytes') ?? 32,
    );
    const grantTtlDays =
      invite.deviceTtlDays ?? this.config.get<number>('device.grantTtlDays') ?? 365;

    const session = await this.connection.startSession();
    let consumedGrantId: Types.ObjectId | undefined;
    let consumedUserId: Types.ObjectId | undefined;
    let consumedKind: 'regular' | 'owner-device' = invite.kind;
    try {
      let result: ConsumedDevice;
      await session.withTransaction(async () => {
        // Re-check invite state inside the transaction for atomic one-time use.
        const fresh = await this.inviteModel
          .findOne({ _id: invite._id })
          .session(session)
          .exec();
        if (!fresh || fresh.consumedAt) {
          throw new ConflictException('Приглашение уже использовано');
        }
        if (fresh.revokedAt || fresh.expiresAt.getTime() <= Date.now()) {
          throw new GoneException(GENERIC_INVITE_ERROR);
        }

        let userId: Types.ObjectId;
        let effectiveRole: string;
        let isOwnerDevice = false;

        if (fresh.kind === 'owner-device') {
          // Bind to the EXISTING single owner; never create a second owner.
          const owner = await this.userModel
            .findOne({ isOwner: true, isActive: true })
            .session(session)
            .exec();
          if (!owner || String(owner._id) !== String(fresh.ownerUserId)) {
            throw new GoneException(GENERIC_INVITE_ERROR);
          }
          userId = owner._id;
          effectiveRole = owner.role;
          isOwnerDevice = true;
        } else {
          const role = await this.roleModel
            .findOne({ name: fresh.role, isActive: true })
            .session(session)
            .exec();
          if (!role) {
            // Fail closed: the preselected role must still exist and be active.
            throw new GoneException(GENERIC_INVITE_ERROR);
          }
          effectiveRole = role.name;
          const deviceUser = await this.createDeviceUser(
            session,
            cleanName,
            effectiveRole,
          );
          userId = deviceUser._id;
        }

        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + grantTtlDays * 24 * 60 * 60 * 1000,
        );
        const [grant] = await this.grantModel.create(
          [
            {
              tokenHash: sha256Hex(grantSecret),
              deviceName: cleanName,
              status: 'active',
              expiresAt,
              activatedAt: now,
              userId,
              inviteKind: fresh.kind,
            },
          ],
          { session },
        );

        await this.inviteModel.updateOne(
          { _id: fresh._id },
          {
            $set: {
              consumedAt: now,
              consumedGrantId: grant._id,
            },
          },
          { session },
        );

        const access = await this.signDeviceJwt(userId.toString());
        consumedGrantId = grant._id;
        consumedUserId = userId;
        consumedKind = fresh.kind;
        result = {
          access,
          grantSecret,
          deviceName: cleanName,
          role: effectiveRole,
          expiresAt,
          isOwner: isOwnerDevice,
          sessionKind: 'device',
        };
      });

      await this.audit.log({
        action: 'device.invite.consumed',
        entityType: 'DeviceInvite',
        entityId: invite._id,
        details: {
          after: {
            deviceName: cleanName,
            inviteKind: consumedKind,
            grantId: consumedGrantId ? String(consumedGrantId) : undefined,
          },
        },
        ipAddress: ip,
        userId: consumedUserId ? String(consumedUserId) : undefined,
      });

      return result!;
    } finally {
      await session.endSession();
    }
  }

  // ----------------------------------------------------------------- session

  /** Cookie-only: issue a short access JWT for an active device grant. */
  async sessionFromCookie(rawSecret: string | undefined): Promise<string> {
    const grant = await this.requireActiveGrant(rawSecret);
    await this.grantModel
      .updateOne({ _id: grant._id }, { $set: { lastUsedAt: new Date() } })
      .exec();
    return this.signDeviceJwt(String(grant.userId));
  }

  /** Cookie-only status probe (used by the UI and nginx auth_request). */
  async statusFromCookie(rawSecret: string | undefined): Promise<DeviceStatus> {
    if (!rawSecret) {
      return { status: 'revoked' };
    }
    const grant = await this.grantModel
      .findOne({ tokenHash: sha256Hex(rawSecret) })
      .lean()
      .exec();
    if (!grant || grant.status !== 'active') {
      return { status: 'revoked' };
    }
    if (grant.expiresAt.getTime() <= Date.now()) {
      return { status: 'expired' };
    }
    const user = await this.userModel.findById(grant.userId).lean().exec();
    if (!user || user.isActive === false) {
      return { status: 'revoked' };
    }
    return { status: 'active', deviceName: grant.deviceName };
  }

  /** Cookie-only boolean gate for nginx auth_request (no personal data). */
  async authCheckFromCookie(rawSecret: string | undefined): Promise<boolean> {
    if (!rawSecret) return false;
    try {
      await this.requireActiveGrant(rawSecret);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ admin

  async listDevices(
    actor: { id: string; isOwner?: boolean },
  ): Promise<Record<string, unknown>[]> {
    const filter: Record<string, unknown> =
      actor.isOwner === true
        ? {}
        : { inviteKind: 'regular' }; // ordinary admin never sees owner devices
    const docs = await this.grantModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const users = await this.userModel
      .find({ _id: { $in: docs.map((d) => d.userId) } })
      .select('_id role username')
      .lean()
      .exec();
    const roleById = new Map(users.map((u) => [String(u._id), u.role as string]));
    return docs.map((d) => this.toClientDevice(d, roleById));
  }

  async listOwnerDevices(): Promise<Record<string, unknown>[]> {
    const docs = await this.grantModel
      .find({ inviteKind: 'owner-device' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => this.toClientDevice(d, new Map()));
  }

  async listInvites(
    actor: { id: string; isOwner?: boolean },
  ): Promise<Record<string, unknown>[]> {
    const filter: Record<string, unknown> =
      actor.isOwner === true ? {} : { kind: 'regular' };
    const docs = await this.inviteModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => this.toClientInvite(d));
  }

  async revokeDevice(
    actor: { id: string; isOwner?: boolean },
    grantId: string,
  ): Promise<Record<string, unknown>> {
    const grant = await this.findGrantOrThrow(grantId, actor);
    grant.status = 'revoked';
    grant.revokedAt = new Date();
    grant.revokedBy = new Types.ObjectId(actor.id);
    await grant.save();
    this.logger.log(`Device grant revoked id=${grant._id} by=${actor.id}`);
    await this.audit.log({
      action: 'device.grant.revoked',
      entityType: 'BrowserDeviceGrant',
      entityId: grant._id,
      details: { after: { deviceName: grant.deviceName, inviteKind: grant.inviteKind } },
      userId: actor.id,
    });
    return this.toClientDevice(grant.toObject() as unknown as Record<string, unknown>, new Map());
  }

  async updateDevice(
    actor: { id: string; isOwner?: boolean },
    grantId: string,
    dto: UpdateDeviceDto,
  ): Promise<Record<string, unknown>> {
    const grant = await this.findGrantOrThrow(grantId, actor);

    // TZ-AUTH-306 — granting OR revoking administrator power is owner-only.
    // An ordinary admin must not promote a device to `admin` nor demote a
    // device that is already an admin (mirror of OwnerTargetGuard).
    const currentUser = await this.userModel.findById(grant.userId).lean().exec();
    const currentRole = currentUser?.role ?? '';
    if (actor.isOwner !== true && (currentRole === 'admin' || dto.role === 'admin')) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Managing administrator devices requires the system owner',
      });
    }

    if (dto.role !== undefined) {
      if (grant.inviteKind === 'owner-device') {
        throw new ForbiddenException({
          code: 'OWNER_ONLY',
          message: 'Owner devices are bound to the owner and cannot change role',
        });
      }
      const role = await this.roleModel
        .findOne({ name: dto.role, isActive: true })
        .lean()
        .exec();
      if (!role) {
        throw new NotFoundException('Выберите существующую активную роль');
      }
      await this.userModel
        .updateOne({ _id: grant.userId }, { $set: { role: role.name } })
        .exec();
    }
    if (dto.deviceName !== undefined) {
      grant.deviceName = dto.deviceName.trim().slice(0, 80);
    }
    if (dto.expiresInDays !== undefined) {
      grant.expiresAt = new Date(
        Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000,
      );
    }
    await grant.save();
    await this.audit.log({
      action: 'device.grant.updated',
      entityType: 'BrowserDeviceGrant',
      entityId: grant._id,
      details: {
        after: {
          deviceName: grant.deviceName,
          role: dto.role,
          expiresInDays: dto.expiresInDays,
        },
      },
      userId: actor.id,
    });
    const user = await this.userModel.findById(grant.userId).select('role').lean().exec();
    return this.toClientDevice(grant.toObject() as unknown as Record<string, unknown>, new Map([
      [String(grant.userId), user?.role as string],
    ]));
  }

  async revokeInvite(
    actor: { id: string; isOwner?: boolean },
    inviteId: string,
  ): Promise<Record<string, unknown>> {
    const invite = await this.inviteModel.findById(inviteId).exec();
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (actor.isOwner !== true && invite.kind !== 'regular') {
      throw new NotFoundException('Invite not found');
    }
    if (!invite.consumedAt && !invite.revokedAt) {
      invite.revokedAt = new Date();
      invite.revokedBy = new Types.ObjectId(actor.id);
      await invite.save();
    }
    await this.audit.log({
      action: 'device.invite.revoked',
      entityType: 'DeviceInvite',
      entityId: invite._id,
      userId: actor.id,
    });
    return this.toClientInvite(invite.toObject() as unknown as Record<string, unknown>);
  }

  // --------------------------------------------------------------- helpers

  private async requireActiveGrant(rawSecret: string | undefined): Promise<BrowserDeviceGrantDocument> {
    if (!rawSecret) {
      throw new UnauthorizedException('No device credential');
    }
    const grant = await this.grantModel
      .findOne({ tokenHash: sha256Hex(rawSecret) })
      .exec();
    if (!grant || grant.status !== 'active') {
      throw new UnauthorizedException('Device credential revoked');
    }
    if (grant.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Device credential expired');
    }
    const user = await this.userModel.findById(grant.userId).lean().exec();
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('Device user inactive');
    }
    if (user.role) {
      const role = await this.roleModel
        .findOne({ name: user.role, isActive: true })
        .lean()
        .exec();
      if (!role) {
        throw new UnauthorizedException('Device role inactive');
      }
    }
    return grant;
  }

  private async findGrantOrThrow(
    grantId: string,
    actor: { id: string; isOwner?: boolean },
  ): Promise<BrowserDeviceGrantDocument> {
    if (!Types.ObjectId.isValid(grantId)) {
      throw new NotFoundException('Device not found');
    }
    const grant = await this.grantModel.findById(grantId).exec();
    if (!grant) {
      throw new NotFoundException('Device not found');
    }
    if (actor.isOwner !== true && grant.inviteKind === 'owner-device') {
      // Hide owner devices from ordinary admins (404, not 403).
      throw new NotFoundException('Device not found');
    }
    return grant;
  }

  private async createDeviceUser(
    session: ClientSession,
    deviceName: string,
    role: string,
  ): Promise<UserDocument> {
    const username = `${DEVICE_USERNAME_PREFIX}${randomBytes(6).toString('hex')}`;
    const passwordHash = await bcrypt.hash(
      randomBytes(32).toString('base64url'),
      BCRYPT_ROUNDS,
    );
    const [doc] = await this.userModel.create(
      [
        {
          username,
          displayName: deviceName,
          passwordHash,
          role,
          permissions: [],
          isActive: true,
          accountType: 'device',
        },
      ],
      { session },
    );
    return doc;
  }

  private async signDeviceJwt(userId: string): Promise<string> {
    const ttlSeconds =
      this.config.get<number>('device.deviceJwtTtlSeconds') ?? 300;
    return this.jwt.signAsync(
      { sub: userId, scope: 'device' },
      {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: `${ttlSeconds}s`,
      },
    );
  }

  private buildInviteUrl(secret: string): string {
    const base =
      this.config.get<string>('device.enrollBaseUrl') ?? 'http://localhost:4200';
    return `${base.replace(/\/$/, '')}/enroll/${secret}`;
  }

  private toClientDevice(
    doc: Record<string, unknown>,
    roleById: Map<string, string>,
  ): Record<string, unknown> {
    const userId = String(doc.userId ?? '');
    return {
      id: String(doc._id ?? ''),
      deviceName: String(doc.deviceName ?? ''),
      status: String(doc.status ?? 'active'),
      inviteKind: String(doc.inviteKind ?? 'regular'),
      role: roleById.get(userId) ?? '',
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt as string).toISOString() : null,
      lastUsedAt: doc.lastUsedAt ? new Date(doc.lastUsedAt as string).toISOString() : null,
      activatedAt: doc.activatedAt ? new Date(doc.activatedAt as string).toISOString() : null,
      revokedAt: doc.revokedAt ? new Date(doc.revokedAt as string).toISOString() : null,
      userId,
    };
  }

  private toClientInvite(doc: Record<string, unknown>): Record<string, unknown> {
    const consumed = Boolean(doc.consumedAt);
    const revoked = Boolean(doc.revokedAt);
    const expired =
      !consumed &&
      !revoked &&
      new Date(doc.expiresAt as string).getTime() <= Date.now();
    return {
      id: String(doc._id ?? ''),
      kind: String(doc.kind ?? 'regular'),
      role: doc.role ? String(doc.role) : null,
      secretPrefix: String(doc.secretPrefix ?? ''),
      status: revoked ? 'revoked' : consumed ? 'consumed' : expired ? 'expired' : 'active',
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt as string).toISOString() : null,
      consumedAt: doc.consumedAt ? new Date(doc.consumedAt as string).toISOString() : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt as string).toISOString() : null,
    };
  }
}
