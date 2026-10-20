import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  KEY_SCOPE_ACCESS,
  KEY_SCOPE_APP_RE,
  KEY_SCOPE_MAX_APPS,
  type KeyScopeAccess,
} from '../../common/guards/key-scope';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DesktopCompatService } from './desktop-compat.service';
import {
  DesktopPairingKeyService,
} from './desktop-pairing-key.service';
import type { DesktopPairingTtl } from './desktop-pairing-key.schema';

/** P2: права ключа. Не передан = full (права выдавшего). */
class PairingKeyScopeDto {
  @IsIn(KEY_SCOPE_ACCESS as KeyScopeAccess[])
  access!: KeyScopeAccess;

  /** Приложения для /api/apps/:app/… — не передан или пуст = все. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KEY_SCOPE_MAX_APPS)
  @IsString({ each: true })
  @Matches(KEY_SCOPE_APP_RE, { each: true })
  apps?: string[];
}

class IssuePairingKeyDto {
  @IsOptional()
  @IsIn(['1d', '7d', '30d', '90d', 'never'])
  ttl?: DesktopPairingTtl;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  /** Origin FE resolves for the packet (required for pairing helper). */
  @IsString()
  @IsUrl({ require_tld: false })
  apiBaseUrl!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PairingKeyScopeDto)
  scope?: PairingKeyScopeDto;
}

@Controller('desktop')
export class DesktopPairingController {
  constructor(
    private readonly keys: DesktopPairingKeyService,
    private readonly compat: DesktopCompatService,
  ) {}

  /** TZD-40: публичный контракт совместимости версий (env-driven, no secrets). */
  @Public()
  @Get('compat')
  compatInfo() {
    return this.compat.compat();
  }

  /** TZD-72: only desktop:admin (or admin role wildcard) may issue keys. */
  @Permissions('desktop:admin')
  @Post('pairing-keys')
  issue(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssuePairingKeyDto) {
    return this.keys.issue(user, {
      ttl: dto.ttl,
      label: dto.label,
      apiBaseUrl: dto.apiBaseUrl,
      scope: dto.scope,
    });
  }

  /** Convenience alias: same as POST pairing-keys (TZD-21 packet helper). */
  @Permissions('desktop:admin')
  @Post('pairing')
  issuePairing(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssuePairingKeyDto) {
    return this.keys.issue(user, {
      ttl: dto.ttl ?? '30d',
      label: dto.label,
      apiBaseUrl: dto.apiBaseUrl,
      scope: dto.scope,
    });
  }

  @Permissions('desktop:admin')
  @Get('pairing-keys')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.keys.listForUser(user.id);
  }

  @Permissions('desktop:admin')
  @Post('pairing-keys/:id/revoke')
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.keys.revoke(user.id, id);
    return { ok: true };
  }
}
