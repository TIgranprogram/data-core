import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DesktopPairingKey,
  DesktopPairingKeySchema,
} from './desktop-pairing-key.schema';
import { DesktopPairingKeyService } from './desktop-pairing-key.service';
import { DesktopCompatService } from './desktop-compat.service';
import { DesktopPairingController } from './desktop-pairing.controller';
import { UserModule } from '../user/user.module';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DesktopPairingKey.name, schema: DesktopPairingKeySchema },
    ]),
    forwardRef(() => UserModule),
    RoleModule,
  ],
  controllers: [DesktopPairingController],
  providers: [DesktopPairingKeyService, DesktopCompatService],
  exports: [DesktopPairingKeyService, MongooseModule],
})
export class DesktopModule {}
