import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModule } from '../user/user.module';
import { RoleModule } from '../role/role.module';
import { AuditModule } from '../audit/audit.module';
import { OwnerOnlyGuard } from '../../common/guards/owner-only.guard';
import { DeviceInvite, DeviceInviteSchema } from './device-invite.schema';
import {
  BrowserDeviceGrant,
  BrowserDeviceGrantSchema,
} from './browser-device-grant.schema';
import { DeviceEnrollmentService } from './device-enrollment.service';
import { DeviceEnrollmentController } from './device-enrollment.controller';
import { DevicesAdminController } from './devices-admin.controller';

/**
 * TZ-AUTH-303 — isolated device-enrollment domain.
 *
 * User / Role / Audit services and models come from their owning modules
 * (which export `MongooseModule`, so `getModelToken(User.name)` etc. resolve
 * to the canonical providers — no duplicate forFeature registration here).
 * Only the two NEW schemas (DeviceInvite, BrowserDeviceGrant) are registered
 * locally.
 *
 * JwtModule is registered against the SAME `jwt.secret` as AuthModule so the
 * short-lived device access JWT is interchangeable with a normal access JWT
 * (JwtStrategy re-hydrates role/permissions/isOwner from the DB each request).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceInvite.name, schema: DeviceInviteSchema },
      { name: BrowserDeviceGrant.name, schema: BrowserDeviceGrantSchema },
    ]),
    UserModule,
    RoleModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [DeviceEnrollmentController, DevicesAdminController],
  providers: [DeviceEnrollmentService, OwnerOnlyGuard],
  exports: [DeviceEnrollmentService],
})
export class DeviceEnrollmentModule {}
