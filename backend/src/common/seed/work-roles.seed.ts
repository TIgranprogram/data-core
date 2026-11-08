import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RoleService } from '../../modules/role/role.service';

/**
 * C050: две готовые роли для цеха. Создаются только если роли нет — правки директора (разделы, «Деньги») не перезаписываются.
 * «Рабочий» — только «Мои задания»; «Мастер» — как менеджер, но без денег: «В работе» (там же Гант) и «Мои задания».
 */
export const WORK_ROLES = [
  { name: 'worker', label: 'Рабочий', description: 'Видит только свои задания: начал, закончил, отложил, проблема. Без цен и ставок', baseRole: 'user', appSections: ['my-tasks'], money: false, sortOrder: 200 },
  { name: 'master', label: 'Мастер', description: 'Распределяет работу в Ганте и разбирает проблемы цеха. Без цен и ставок', baseRole: 'manager', appSections: ['work', 'my-tasks'], money: false, sortOrder: 210 },
] as const;

@Injectable()
export class WorkRolesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkRolesSeed.name);

  constructor(private readonly roles: RoleService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const r of WORK_ROLES) {
      try {
        if (await this.roles.findByName(r.name)) continue;
        await this.roles.create({ ...r, appSections: [...r.appSections], permissions: [], isSystem: false });
        this.logger.log(`Role seeded: ${r.name}`);
      } catch (err) {
        this.logger.warn(`Could not seed role ${r.name}: ${(err as Error).message}`);
      }
    }
  }
}
