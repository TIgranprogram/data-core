import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { RoleCounterpartyService } from '../../modules/role-counterparty/role-counterparty.service';

const DEFAULT_COUNTERPARTY_ROLES = [
  { slug: 'customer',     name: 'Customer',     description: 'Покупатель', isSystem: true },
  { slug: 'supplier',     name: 'Supplier',     description: 'Поставщик',  isSystem: true },
  { slug: 'contractor',   name: 'Contractor',   description: 'Подрядчик',  isSystem: true },
  { slug: 'manufacturer', name: 'Manufacturer', description: 'Производитель', isSystem: true },
];

@Injectable()
export class CounterpartyRolesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(CounterpartyRolesSeed.name);

  constructor(private readonly roles: RoleCounterpartyService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const r of DEFAULT_COUNTERPARTY_ROLES) {
      const exists = await this.roles.findBySlug(r.slug);
      if (exists) continue;
      try {
        await this.roles.create({ ...r, isActive: true });
        this.logger.log(`CounterpartyRole seeded: ${r.slug}`);
      } catch (err) {
        this.logger.warn(`Could not seed CounterpartyRole ${r.slug}: ${(err as Error).message}`);
      }
    }
  }
}
