import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Worker, WorkerSchema } from './worker.schema';
import { WorkerService } from './worker.service';
import { WorkerController } from './worker.controller';
import { WorkType, WorkTypeSchema } from '../work-type/work-type.schema';
import { Organization, OrganizationSchema } from '../organization/organization.schema';
import { User, UserSchema } from '../user/user.schema';

/**
 * TZ-WORKERS-301 — WorkerModule.
 *
 * Регистрирует собственный Worker schema + schema ссылочных сущностей
 * (WorkType, Organization, User) для @InjectModel-token'ов в сервисе.
 * Паттерн TZ-DOC-315: schema регистрируется здесь напрямую, без
 * module-level import — нет circular dependencies с WorkTypeModule /
 * OrganizationModule / UserModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Worker.name, schema: WorkerSchema },
      { name: WorkType.name, schema: WorkTypeSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WorkerController],
  providers: [WorkerService],
  exports: [WorkerService, MongooseModule],
})
export class WorkerModule {}
