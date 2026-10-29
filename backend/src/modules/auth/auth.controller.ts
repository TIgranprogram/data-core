import {
  Body,
  Controller,
  ForbiddenException,
  GoneException,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
  Get,
  Ip,
  Logger,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthService } from './auth.service';
import { ConfirmDto } from './dto/confirm.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ProfileDto } from './dto/profile.dto';
import { UiPrefsDto } from './dto/ui-prefs.dto';
import { UserService } from '../user/user.service';

interface RefreshPayload {
  id: string;
  version: number;
  remember?: boolean;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly users: UserService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Public register disabled (TZ-AUTH-308) - use device invite' })
  @ApiResponse({ status: 410, description: 'Gone - public registration removed; use device invite' })
  register(): never {
    // TZ-AUTH-308: classic public register is off. People access = Devices invite.
    // Owner break-glass remains POST /api/auth/login.
    throw new GoneException('Public registration is disabled. Use a device invite link.');
  }

  @Public()
  @Throttle({ short: { ttl: 60_000, limit: 5 }, long: { ttl: 3_600_000, limit: 20 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password' })
  @ApiResponse({ status: 200, description: 'Login successful, returns access token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(dto, res, ip);
  }

  @Public()
  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Body() _dto: RefreshTokenDto,
    @CurrentUser() payload: RefreshPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(payload.id, payload.version, res, payload.remember);
  }

  @Post('logout')
  @Roles('admin', 'manager', 'user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and clear refresh token cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@CurrentUser() me: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(me.id);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return { ok: true };
  }

  /**
   * Подтверждение паролем перед удалением (не-admin): пароль самого пользователя → токен на 120 с.
   * Токен шлют в заголовке X-Confirm-Token на DELETE/restore заказов, заявок, позиций склада, контрагентов.
   * Неверный пароль — 403 (не 401: клиент не должен считать сессию просроченной). Пароль не логируется.
   */
  @Post('confirm')
  @Roles('admin', 'manager', 'user')
  @Throttle({ short: { ttl: 60_000, limit: 5 }, long: { ttl: 3_600_000, limit: 30 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить действие своим паролем: токен на 120 с' })
  @ApiResponse({ status: 200, description: '{ token, expiresIn: 120 }' })
  @ApiResponse({ status: 403, description: 'Неверный пароль или вход по ключу kppd_' })
  confirm(@CurrentUser() me: AuthenticatedUser, @Body() dto: ConfirmDto) {
    if (me.keyScope) throw new ForbiddenException('Подтверждение паролем — только из входа в приложение');
    return this.auth.confirmPassword(me.id, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@CurrentUser() me: AuthenticatedUser) {
    return this.auth.getMe(me.id);
  }

  /** Свой профиль: имя, телефон, аватар. Роль, логин, пароль не меняются (400 на лишние поля). */
  @Patch('me')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Сохранить свой профиль (displayName, phone, avatar)' })
  @ApiResponse({ status: 200, description: 'Обновлённый профиль, как GET /auth/me' })
  @ApiResponse({ status: 400, description: 'Лишнее поле, слишком длинное значение, неверный аватар' })
  @ApiResponse({ status: 403, description: 'Вход по ключу kppd_' })
  async updateProfile(@CurrentUser() me: AuthenticatedUser, @Body() dto: ProfileDto) {
    if (me.keyScope) throw new ForbiddenException('Профиль меняется только из входа в приложение');
    return this.auth.updateProfile(me.id, dto);
  }

  /**
   * ШП-1 — свои настройки интерфейса (ширины панелей). id — только из входа.
   * Любая роль: @Roles('user') по иерархии пропускает все встроенные и свои
   * роли (r-…). Раздела (@AppSection) нет — AppSectionGuard не ограничивает.
   * Ключ kppd_ (у него JwtAuthGuard кладёт keyScope) → 403.
   */
  @Patch('me/prefs')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Сохранить свои настройки интерфейса (ширины панелей)' })
  @ApiResponse({ status: 200, description: '{ uiPrefs } — итоговые настройки' })
  @ApiResponse({ status: 400, description: 'Значение вне пределов, не целое или лишний ключ' })
  @ApiResponse({ status: 403, description: 'Вход по ключу kppd_' })
  async updatePrefs(@CurrentUser() me: AuthenticatedUser, @Body() dto: UiPrefsDto) {
    if (me.keyScope) {
      throw new ForbiddenException('Настройки интерфейса меняются только из входа в приложение');
    }
    return this.auth.updateUiPrefs(me.id, dto);
  }
}
