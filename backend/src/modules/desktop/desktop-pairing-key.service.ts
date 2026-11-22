import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { UserService } from '../user/user.service';
import { RoleService } from '../role/role.service';
import {
  DesktopPairingKey,
  DesktopPairingKeyDocument,
  DesktopPairingTtl,
} from './desktop-pairing-key.schema';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { normalizeKeyScope, type KeyScope } from '../../common/guards/key-scope';

const MAX_ACTIVE = 10;
const PREFIX = 'kppd_';
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const TTL_MS: Record<Exclude<DesktopPairingTtl, 'never'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function hashPairingSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function isPairingKeyBearer(token: string): boolean {
  return token.startsWith(PREFIX);
}

function storedKeyScope(row: { scope?: unknown }): KeyScope | null {
  return Object.prototype.hasOwnProperty.call(row, 'scope')
    ? normalizeKeyScope(row.scope ?? null)
    : normalizeKeyScope(undefined);
}

@Injectable()
export class DesktopPairingKeyService {
  constructor(
    @InjectModel(DesktopPairingKey.name)
    private readonly model: Model<DesktopPairingKeyDocument>,
    private readonly users: UserService,
    private readonly roles: RoleService,
  ) {}

  async issue(
    user: AuthenticatedUser,
    opts: {
      ttl?: DesktopPairingTtl;
      label?: string;
      apiBaseUrl: string;
      scope?: { access: string; apps?: string[] };
    },
  ): Promise<{
    id: string;
    apiKey: string;
    expiresAt: string | null;
    label: string;
    tokenPrefix: string;
    scope: KeyScope;
    pairing: {
      apiBaseUrl: string;
      apiKey: string;
      username: string;
      expiresAt: string | null;
    };
  }> {
    const ttl: DesktopPairingTtl = opts.ttl ?? '30d';
    if (!['1d', '7d', '30d', '90d', 'never'].includes(ttl)) {
      throw new BadRequestException('Invalid ttl');
    }

    const scope = normalizeKeyScope(opts.scope);
    if (!scope) {
      throw new BadRequestException(
        'Некорректный scope.access или scope.apps. Для режима app укажите одно доступное имя приложения.',
      );
    }

    const active = await this.countActive(user.id);
    if (active >= MAX_ACTIVE) {
      throw new BadRequestException(
        `Достигнут лимит активных ключей (${MAX_ACTIVE}). Отзовите неиспользуемые.`,
      );
    }

    const secret = `${PREFIX}${randomBytes(24).toString('base64url')}`;
    const tokenHash = hashPairingSecret(secret);
    const tokenPrefix = secret.slice(0, PREFIX.length + 8);
    const expiresAt =
      ttl === 'never' ? null : new Date(Date.now() + TTL_MS[ttl]);
    const label = (opts.label?.trim() || 'Desktop').slice(0, 64);

    const doc = await this.model.create({
      userId: new Types.ObjectId(user.id),
      organizationId: user.organizationId
        ? new Types.ObjectId(user.organizationId)
        : null,
      label,
      tokenHash,
      tokenPrefix,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      // Без scope в запросе поле не пишем — ключ ведёт себя как раньше (full).
      ...(opts.scope === undefined ? {} : { scope }),
    });

    return {
      id: doc.id,
      apiKey: secret,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      label,
      tokenPrefix,
      scope,
      pairing: {
        apiBaseUrl: opts.apiBaseUrl,
        apiKey: secret,
        username: user.username,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    };
  }

  async listForUser(userId: string): Promise<
    Array<{
      id: string;
      label: string;
      tokenPrefix: string;
      expiresAt: string | null;
      revokedAt: string | null;
      createdAt: string | null;
      lastUsedAt: string | null;
      scope: KeyScope | null;
    }>
  > {
    // Active keys only — revoked rows are deleted on revoke (PO: не висеть в UI).
    const rows = await this.model
      .find({ userId: new Types.ObjectId(userId), revokedAt: null })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return rows.map((r) => ({
      id: String(r._id),
      label: r.label,
      tokenPrefix: r.tokenPrefix,
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
      revokedAt: null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
      scope: storedKeyScope(r),
    }));
  }

  async revoke(userId: string, keyId: string): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) {
      throw new NotFoundException('Key not found');
    }
    const res = await this.model
      .deleteOne({ _id: keyId, userId: new Types.ObjectId(userId) })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('Key not found');
    }
  }

  /**
   * Validate opaque Bearer `kppd_…` → AuthenticatedUser (same shape as JWT).
   */
  async authenticateBearer(token: string): Promise<AuthenticatedUser> {
    if (!isPairingKeyBearer(token)) {
      throw new UnauthorizedException('Not a pairing key');
    }
    const tokenHash = hashPairingSecret(token);
    // Читаем scope как записан в Mongo, без приведения типов Mongoose:
    // повреждённое поле не должно превратиться в отсутствующее или валидное.
    const doc = await this.model.findOne({ tokenHash }).lean().exec();
    if (!doc) {
      throw new UnauthorizedException('Invalid pairing key');
    }
    if (doc.revokedAt) {
      throw new UnauthorizedException('Pairing key revoked');
    }
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Pairing key expired');
    }

    const scope = storedKeyScope(doc);
    if (!scope) {
      throw new UnauthorizedException('Разрешения ключа повреждены. Обратитесь к администратору.');
    }
    const user = await this.users.findById(doc.userId.toString()).catch((error: unknown) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    let rolePermissions: string[] | undefined;
    if (scope.access === 'app') {
      const { role, access } = await this.roles.resolveForAuth(user.role);
      if (!role || role.isActive === false || !access || access.isActive === false) {
        throw new UnauthorizedException('Роль выдавшего ключ отключена или удалена.');
      }
      rolePermissions = access.permissions ?? [];
    }

    void this.touchLastUsed(doc._id, doc.lastUsedAt);

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions ?? [],
      ...(rolePermissions ? { rolePermissions } : {}),
      organizationId: user.organizationId?.toString() ?? null,
      keyScope: scope,
    };
  }

  /** Constant-time compare helper for tests. */
  secretsEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  private async countActive(userId: string): Promise<number> {
    const now = new Date();
    return this.model
      .countDocuments({
        userId: new Types.ObjectId(userId),
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .exec();
  }

  private async touchLastUsed(id: Types.ObjectId, previous: Date | null): Promise<void> {
    const now = Date.now();
    if (now - (previous?.getTime() ?? 0) < LAST_USED_THROTTLE_MS) return;
    try {
      await this.model.updateOne({ _id: id, lastUsedAt: previous }, { $set: { lastUsedAt: new Date(now) } }).exec();
    } catch {
      /* ignore race */
    }
  }
}
