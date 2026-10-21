import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { OwnerOnlyGuard } from '../../common/guards/owner-only.guard';
import { DeviceEnrollmentService } from './device-enrollment.service';
import {
  CreateRegularInviteDto,
  CreateOwnerInviteDto,
} from './dto/create-invite.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

/**
 * TZ-AUTH-303 — admin device + invite management.
 *
 * Authorization posture (same global stack as the rest of /api/admin/*):
 * JwtAuthGuard → PermissionsGuard (`user:admin`) → RolesGuard (`admin`).
 *
 * Owner-only surface (`owner-invite`, `owner` device listing) is additionally
 * gated by `OwnerOnlyGuard`; ordinary admins cannot enumerate or mutate owner
 * devices/invites (404, not 403, on the device paths — see the service).
 */
@Controller('admin/devices')
export class DevicesAdminController {
  constructor(private readonly service: DeviceEnrollmentService) {}

  // ------------------------------------------------------------ invites

  @Post('invites')
  @Permissions('user:admin')
  @Roles('admin')
  async createInvite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegularInviteDto,
  ) {
    return this.service.issueRegularInvite(actor, dto);
  }

  @Get('invites')
  @Permissions('user:admin')
  @Roles('admin')
  async listInvites(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listInvites(actor);
  }

  @Post('invites/:id/revoke')
  @Permissions('user:admin')
  @Roles('admin')
  async revokeInvite(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.revokeInvite(actor, id);
  }

  @Post('owner-invite')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerOnlyGuard)
  async createOwnerInvite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateOwnerInviteDto,
  ) {
    return this.service.issueOwnerInvite(actor, dto);
  }

  // ------------------------------------------------------------ devices

  @Get()
  @Permissions('user:admin')
  @Roles('admin')
  async listDevices(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listDevices(actor);
  }

  @Get('owner')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerOnlyGuard)
  async listOwnerDevices() {
    return this.service.listOwnerDevices();
  }

  @Patch(':id')
  @Permissions('user:admin')
  @Roles('admin')
  async updateDevice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.service.updateDevice(actor, id, dto);
  }

  @Post(':id/revoke')
  @Permissions('user:admin')
  @Roles('admin')
  async revokeDevice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.revokeDevice(actor, id);
  }
}
