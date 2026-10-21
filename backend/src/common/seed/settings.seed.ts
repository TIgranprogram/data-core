import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SettingService } from '../../modules/setting/setting.service';

const DEFAULT_SETTINGS = [
  {
    key: 'currency',
    value: 'RUB',
    group: 'finance',
    description: 'Default currency code (ISO 4217)',
  },
  {
    key: 'vatRate',
    value: 20,
    group: 'finance',
    description: 'Default VAT rate in percent',
  },
  {
    key: 'paymentTermDays',
    value: 10,
    group: 'finance',
    description: 'Default payment term in days',
  },
  {
    key: 'fiscalYearStart',
    value: '01-01',
    group: 'finance',
    description: 'Fiscal year start date (MM-DD)',
  },
  {
    key: 'companyName',
    value: 'KPPDF',
    group: 'general',
    description: 'Company name used in documents',
  },
] as const;

@Injectable()
export class SettingsSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettingsSeed.name);

  constructor(private readonly settings: SettingService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const s of DEFAULT_SETTINGS) {
      const existing = await this.settings
        .findAll(s.group)
        .then((arr) => arr.find((d) => d.key === s.key));
      if (existing) continue;
      try {
        await this.settings.set(s.key, s.value, s.group, s.description);
        this.logger.log(`Default setting seeded: ${s.key}`);
      } catch (err) {
        this.logger.warn(`Could not seed setting ${s.key}: ${(err as Error).message}`);
      }
    }
  }
}
