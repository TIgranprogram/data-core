import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Permission, PermissionSchema } from './permission.schema';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Permission.name, schema: PermissionSchema },
    ]),
  ],
  providers: [PermissionsService],
  exports: [PermissionsService, MongooseModule],
})
export class PermissionsModule {}
