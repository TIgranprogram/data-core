import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { UiPrefs, UserDocument } from '../user/user.schema';
import { UserService } from '../user/user.service';
import { RoleService } from '../role/role.service';
import { LoginSoftlockService } from '../../common/login-softlock/login-softlock.service';
import { AuthResponse, AccessTokenResponse, AuthUserPayload } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { effectivePermissions } from '../../common/contracts/rbac-contract';
import { CONFIRM_TTL_SEC, signConfirmToken } from '../../common/confirm-token';
import { appSectionsFor } from '../../common/app-sections';
import { roleLabelOf } from '../../common/roles-hierarchy';

/**
 * Single-source-of-truth generic login error.
 *
 * TZ-249 §2.3 demands that the response body is **byte-for-byte identical**
 * for "no such user" and "wrong password" so an attacker cannot enumerate
 * valid usernames by comparing 401 bodies. The audit log keeps the
 * distinguishing context (`login_attempt_unknown_user` vs.
 * `login_attempt_wrong_password`) so forensics stay intact.
 */
const GENERIC_BAD_CREDENTIALS_MESSAGE = 'Неверный логин или пароль';

/**
 * Pre-computed bcrypt hash used as the comparison target when the
 * supplied username does not exist. Computing it once at module load
 * cost (~80-100 ms with COST=10) keeps the missing-user branch of the
 * login flow at parity with the wrong-password branch in terms of CPU
 * time — preventing username-enumeration via timing side-channels (TZ-249
 * §2.3 second bullet).
 *
 * The plaintext (`__not_a_real_password__`) NEVER matches any real
 * account's hash, so no false-positive authentication is possible.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('__not_a_real_password__', 10);

/**
 * TZ-AUTH-306 — owner-only page keys. These pages are reachable only by the
 * single hidden owner; they are stripped from `pages` for non-owners so the
 * nav/chip/page-ACL never renders them. Role CRUD + permissions matrix are
 * the owner-only surface; no role ever grants `admin-roles`.
 */
const OWNER_ONLY_PAGE_KEYS = new Set<string>(['admin-roles']);

/** «Запомнить меня»: скользящий срок refresh, дней. */
export const REMEMBER_DAYS = 90;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly softlock: LoginSoftlockService,
    private readonly roles: RoleService,
  ) {}

  /** Пароль текущего пользователя верный → короткоживущий токен подтверждения (пароль не логируем). */
  async confirmPassword(userId: string, password: string): Promise<{ token: string; expiresIn: number }> {
    const user = await this.users.findByIdWithHash(userId);
    if (!user || !user.isActive || !(await this.users.verifyPassword(user, password))) {
      this.logger.warn(`confirm_wrong_password user=${userId}`);
      throw new ForbiddenException('Неверный пароль');
    }
    return { token: signConfirmToken(userId), expiresIn: CONFIRM_TTL_SEC };
  }

  async register(dto: RegisterDto, res: Response): Promise<AuthResponse> {
    const isProd = this.config.get<string>('nodeEnv') === 'production';

    // TZ-249 §2.2: in production, ROLE COERCE — any non-'user' role arriving
    // via /auth/register is silently coerced to 'user'. We do NOT throw 403
    // because that's a louder fingerprint than the silent coerce and would
    // break the existing dev/test fixtures that intentionally request
    // 'manager'. Warn-level audit log captures the attempted escalation for
    // forensics.
    let effectiveRole: 'user' | 'manager';
    const incomingRole = dto.role ?? 'user';
    if (incomingRole === 'user' || incomingRole === 'manager') {
      effectiveRole = incomingRole;
    } else {
      // Unexpected role string (DTO Transform should have validated this,
      // but defensive default is never wrong). Falls back to 'user'.
      effectiveRole = 'user';
    }
    if (isProd && effectiveRole !== 'user') {
      this.logger.warn(
        `Refusing privileged role escalation: ${dto.username} ` +
          `attempted role=${effectiveRole}; coerced to 'user' (TZ-249 §2.2)`,
      );
      effectiveRole = 'user';
    }

    // First admin/manager accounts MUST come from admin.seed or admin-invite
    // (TZ-91 §4 Phase A.1 baseline) — never via /auth/register.

    const user = await this.users.create({
      username: dto.username,
      email: dto.email,
      displayName: dto.displayName,
      password: dto.password,
      role: effectiveRole,
      permissions: dto.permissions ?? [],
      isActive: dto.isActive ?? true,
      phone: dto.phone,
      fullName: dto.fullName,
    });
    this.logger.log(`User registered: ${user.username} (${user.role})`);
    return this.buildAuthResponse(user, res);
  }

  async login(
    dto: LoginDto,
    res: Response,
    ip?: string,
  ): Promise<AuthResponse> {
    const usernameRaw = dto.username ?? '';
    const usernameNormalized = usernameRaw.trim().toLowerCase();

    // TZ-249 §2.4: pre-check softlock BEFORE bcrypt — an attacker hammering
    // a locked-out username should get a constant-time 401 without burning
    // CPU on a doomed bcrypt round.
    if (this.softlock.isLocked(usernameNormalized)) {
      const until = this.softlock.lockedUntil(usernameNormalized);
      this.logger.warn(
        `login_attempt_locked_out username=${usernameRaw} ` +
          `lockedUntil=${new Date(until).toISOString()} ip=${ip ?? '?'}`,
      );
      throw new UnauthorizedException(GENERIC_BAD_CREDENTIALS_MESSAGE);
    }

    const user = await this.users.findByUsername(dto.username);
    if (!user || !user.isActive) {
      // TZ-249 §2.3: timing-safe bcrypt-dummy compare so an attacker cannot
      // distinguish "no such user" from "wrong password" via wall-clock
      // latency. The exact same exception follows.
      await bcrypt
        .compare(dto.password ?? '', DUMMY_BCRYPT_HASH)
        .catch(() => undefined);
      this.logger.warn(
        `login_attempt_unknown_user username=${usernameRaw} ip=${ip ?? '?'}`,
      );
      throw new UnauthorizedException(GENERIC_BAD_CREDENTIALS_MESSAGE);
    }

    const ok = await this.users.verifyPassword(user, dto.password);
    if (!ok) {
      // TZ-249 §2.4: increment softlock bucket on failed verify.
      this.softlock.recordFailure(usernameNormalized);
      this.logger.warn(
        `login_attempt_wrong_password username=${user.username} ip=${ip ?? '?'}`,
      );
      throw new UnauthorizedException(GENERIC_BAD_CREDENTIALS_MESSAGE);
    }

    // Successful login — clear the softlock bucket.
    this.softlock.reset(usernameNormalized);
    user.lastLoginAt = new Date();
    await user.save();
    this.logger.log(`User logged in: ${user.username}`);
    return this.buildAuthResponse(user, res, dto.remember ?? true);
  }

  /**
   * Called by the /auth/refresh endpoint. The `id` and `version` come from
   * the validated JWT payload (see JwtRefreshStrategy.validate). If we
   * reach this point, the token is signed, unexpired, and matches the
   * current user version.
   */
  async refresh(userId: string, version: number, res: Response, remember = true): Promise<AccessTokenResponse> {
    const user = await this.findActiveUserOrThrow(userId);
    if (user.refreshTokenVersion !== version) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    const access = await this.signAccess(user);
    // скользящий срок: каждый успешный refresh выдаёт новый токен на полный срок (90 дней при «Запомнить меня»)
    const refresh = await this.signRefresh(user, remember);
    this.setRefreshCookie(res, refresh, remember);
    return { access, refresh };
  }

  /**
   * TZ-92 Phase 1: safe projection for the /auth/me endpoint.
   *
   * Previously the GET /me controller returned UserService.findById(me.id) —
   * a full `UserDocument` including `passwordHash`, `refreshTokenVersion`, and
   * any other internal fields. This was HIGH severity QA-01:1.4: any
   * authenticated user could read their own `refreshTokenVersion`, and the
   * value would have leaked in a cross-user read too (admin viewing user).
   *
   * Fix: re-use the existing private `toAuthUser` projection which strips the
   * sensitive fields. Returns `AuthUserPayload` — the same shape the
   * `register` + `login` endpoints return in their `user:` response slot,
   * enriched with optional `phone` + `fullName` per TZ-92.1.
   *
   * Security: throws 401 if user is missing/inactive rather than 404
   * to avoid fingerprinting ("user exists but is disabled" leaks), via
   * the shared `findActiveUserOrThrow` helper.
   */
  async getMe(userId: string): Promise<AuthUserPayload> {
    const user = await this.findActiveUserOrThrow(userId);
    return this.toAuthUser(user, await this.roles.resolveForAuth(user.role));
  }

  /** ШП-1 — свои настройки интерфейса: только активный пользователь, запись по ключам. */
  async updateUiPrefs(userId: string, prefs: UiPrefs): Promise<{ uiPrefs: UiPrefs }> {
    await this.findActiveUserOrThrow(userId);
    return { uiPrefs: await this.users.setUiPrefs(userId, prefs) };
  }

  /** Свой профиль (имя, телефон, аватар); возвращает обновлённый профиль как GET /auth/me. */
  async updateProfile(userId: string, dto: { displayName?: string; phone?: string; avatar?: string }): Promise<AuthUserPayload> {
    await this.findActiveUserOrThrow(userId);
    await this.users.setProfile(userId, dto);
    return this.getMe(userId);
  }

  async logout(userId: string): Promise<void> {
    await this.users.incrementRefreshVersion(userId);
    this.logger.log(`User logged out (id=${userId})`);
  }

  // --- helpers ---

  /**
   * TZ-92.1 helper-extraction: pattern (`users.findById(id)` + `isActive`
   * check + throw `UnauthorizedException`) was duplicated in `refresh` and
   * `getMe`. Folded into a single private helper so future endpoints (e.g.
   * change-password, profile update) reuse the same fingerprinting-safe
   * lookup.
   *
   * Returns the FULL `UserDocument` (still has passwordHash etc.) — callers
   * are responsible for projecting via `toAuthUser` before returning to
   * the client. The helper exists ONLY to centralize the existence +
   * active-check, not the projection decision.
   */
  private async findActiveUserOrThrow(userId: string): Promise<UserDocument> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return user;
  }

  private async buildAuthResponse(user: UserDocument, res: Response, remember = true): Promise<AuthResponse> {
    const [access, refresh, role] = await Promise.all([
      this.signAccess(user),
      this.signRefresh(user, remember),
      this.roles.resolveForAuth(user.role),
    ]);
    this.setRefreshCookie(res, refresh, remember);
    return {
      access,
      refresh,
      user: this.toAuthUser(user, role),
    };
  }

  private setRefreshCookie(res: Response, token: string, remember = true): void {
    // path must match global prefix (/api) + auth controller base (/auth)
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      // без «Запомнить меня» — сессионная cookie (до закрытия браузера)
      ...(remember ? { maxAge: REMEMBER_DAYS * 24 * 60 * 60 * 1000 } : {}),
      path: '/api/auth',
    });
  }

  private async signAccess(user: UserDocument): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        version: user.refreshTokenVersion,
        orgId: user.organizationId?.toString() ?? null,
      },
      {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: this.config.get<string>('jwt.expiresIn') ?? '15m',
      },
    );
  }

  private async signRefresh(user: UserDocument, remember = true): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, version: user.refreshTokenVersion, rem: remember },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: remember
          ? `${REMEMBER_DAYS}d`
          : this.config.get<string>('jwt.refreshExpiresIn') ?? '30d',
      },
    );
  }

  /**
   * SK-8c: `resolved.role` — роль пользователя (название, разделы меню),
   * `resolved.access` — откуда права и pages (у своей роли — её baseRole).
   */
  private toAuthUser(
    user: UserDocument,
    resolved?: {
      role: { name: string; label?: string | null; appSections?: string[] | null } | null;
      access: { name: string; permissions?: string[] | null; pages?: string[] | null } | null;
      baseRole: string;
    } | null,
  ): AuthUserPayload {
    const roleDoc = resolved?.role ?? null;
    const accessDoc = resolved?.access ?? null;
    const pages = accessDoc?.pages ?? [];
    const isOwner = user.isOwner === true;
    // TZ-AUTH-306 — owner-only pages are stripped for everyone but the
    // owner, so the role editor surface is hidden from ordinary admins via
    // the existing page-ACL nav/chip filter (no owner-only flag in the role).
    const visiblePages = isOwner
      ? pages
      : pages.filter((p) => !OWNER_ONLY_PAGE_KEYS.has(p));
    return {
      id: user.id,
      username: user.username,
      email: user.email ?? '',
      displayName: user.displayName,
      role: user.role,
      // SK-8c: права приложения — по baseRole (у встроенной — она сама); roleLabel — название для людей.
      baseRole: resolved?.baseRole ?? user.role,
      roleLabel: roleLabelOf(user.role, roleDoc?.label),
      permissions: Array.from(effectivePermissions(user, accessDoc)),
      // TZ-ACCESS-301: page ACL delivered via /auth/me.
      pages: visiblePages,
      // SK-8a: разделы «Рабочего места» по роли; null — как раньше (по иерархии), у admin всегда null.
      sections: appSectionsFor(user.role, roleDoc?.appSections),
      // TZ-92.1: optional fields preserved from UserDocument. Null is the
      // pre-TZ-92.1 default for users created before phone/fullName fields
      // were added to RegisterDto.
      phone: user.phone ?? null,
      fullName: user.fullName ?? null,
      avatar: user.avatar ?? null,
      // ШП-1: ширины панелей; у старых записей поля нет → {}.
      uiPrefs: user.uiPrefs ?? {},
      organizationId: user.organizationId?.toString() ?? null,
      // TZ-AUTH-306: exposed only to the owner; false for everyone else.
      isOwner,
    };
  }
}
