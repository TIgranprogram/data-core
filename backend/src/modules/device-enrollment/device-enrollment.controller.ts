import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeviceEnrollmentService } from './device-enrollment.service';
import { ConsumeInviteDto } from './dto/consume-invite.dto';
import {
  readCookie,
  setDeviceCookie,
} from './device-cookie';

/**
 * TZ-AUTH-303 — public device enrollment surface.
 *
 * All endpoints are cookie-centric: they NEVER accept a JWT, `kppd_` pairing
 * key, Authorization Bearer, `X-Access-Token`, body token, or query token as
 * a device credential. The only credential is the `__Host-` device cookie.
 *
 *   POST /device/enroll      — one-time invite consumption → sets cookie + JWT
 *   GET  /device/session     — cookie-only: issue a fresh ≤5m access JWT
 *   GET  /device/status      — cookie-only: active | revoked | expired + name
 *   GET  /device/auth-check  — cookie-only boolean gate for nginx auth_request
 */
@Controller('device')
export class DeviceEnrollmentController {
  private readonly cookieName: string;

  constructor(
    private readonly service: DeviceEnrollmentService,
    config: ConfigService,
  ) {
    this.cookieName =
      config.get<string>('device.cookieName') ?? '__Host-kppdf-device';
  }

  @Public()
  @Throttle({ short: { ttl: 60_000, limit: 6 }, long: { ttl: 3_600_000, limit: 30 } })
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  async enroll(
    @Body() dto: ConsumeInviteDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.consumeInvite(
      dto.secret,
      dto.deviceName,
      ip,
    );
    // The raw grant secret goes into the cookie ONLY — never into the body.
    setDeviceCookie(
      res,
      this.cookieName,
      result.grantSecret,
      result.expiresAt.getTime() - Date.now(),
    );
    return {
      access: result.access,
      deviceName: result.deviceName,
      role: result.role,
      expiresAt: result.expiresAt.toISOString(),
      isOwner: result.isOwner,
      // TZ-AUTH-304: explicit device-session marker — never mixed with a
      // password session in the SPA (cookie-renew vs refresh-token renew).
      sessionKind: result.sessionKind,
    };
  }

  @Public()
  @Get('session')
  @HttpCode(HttpStatus.OK)
  async session(@Req() req: Request) {
    const secret = readCookie(req, this.cookieName);
    const access = await this.service.sessionFromCookie(secret);
    return { access, sessionKind: 'device' as const };
  }

  @Public()
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async status(@Req() req: Request) {
    const secret = readCookie(req, this.cookieName);
    return this.service.statusFromCookie(secret);
  }

  @Public()
  @Get('auth-check')
  @HttpCode(HttpStatus.OK)
  async authCheck(@Req() req: Request) {
    const secret = readCookie(req, this.cookieName);
    const ok = await this.service.authCheckFromCookie(secret);
    if (!ok) {
      throw new UnauthorizedException('No active device credential');
    }
    // No personal data returned — this is a boolean gate for nginx auth_request.
    return { ok: true };
  }
}
