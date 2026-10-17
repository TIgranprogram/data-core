import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { RoleOrgService } from '../../modules/role-org/role-org.service';

const DEFAULT_ORG_ROLES = [
  { slug: 'our-company',  name: 'Our company', description: 'Наша компания', isSystem: true },
  { slug: 'partner',      name: 'Partner',     description: 'Партнёр',         isSystem: true },
  { slug: 'holding',      name: 'Holding',     description: 'Головная компания / холдинг', isSystem: true },
  { slug: 'branch',       name: 'Branch',      description: 'Филиал / обособленное подразделение', isSystem: true },
];

@Injectable()
export class OrgRolesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrgRolesSeed.name);

  constructor(private readonly roles: RoleOrgService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const r of DEFAULT_ORG_ROLES) {
      const exists = await this.roles.findBySlug(r.slug);
      if (exists) continue;
      try {
        await this.roles.create({ ...r, isActive: true });
        this.logger.log(`OrgRole seeded: ${r.slug}`);
      } catch (err) {
        this.logger.warn(`Could not seed OrgRole ${r.slug}: ${(err as Error).message}`);
      }
    }
  }
}
