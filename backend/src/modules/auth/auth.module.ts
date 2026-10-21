import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { RoleModule } from '../role/role.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { LoginSoftlockService } from '../../common/login-softlock/login-softlock.service';

@Module({
  imports: [
    UserModule,
    // ACCESS-301+: AuthService resolves role.pages via RoleService.findByName
    RoleModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn') ?? '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    // TZ-249 §2.4 — softlock service is module-scoped. Single instance per
    // AuthModule; multi-pod Redis swap is a follow-up but the public API
    // (isLocked / recordFailure / reset) stays identical.
    LoginSoftlockService,
  ],
  exports: [AuthService, JwtModule, PassportModule, JwtStrategy],
})
export class AuthModule {}
