import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { FeatureFlagService } from '../../modules/feature-flag/feature-flag.service';

const DEFAULT_FLAGS = [
  {
    key: 'new_ui',
    label: 'New UI',
    description: 'Enable redesigned UI shell',
    enabledByDefault: false,
    category: 'ui',
    isActive: true,
  },
  {
    key: 'e2e_payments',
    label: 'End-to-end payments',
    description: 'Allow full payment flow without manual confirmation',
    enabledByDefault: false,
    category: 'finance',
    isActive: true,
  },
  {
    key: 'dark_mode',
    label: 'Dark mode',
    description: 'Enable dark theme in the frontend',
    enabledByDefault: false,
    category: 'ui',
    isActive: true,
  },
  {
    key: 'advanced_analytics',
    label: 'Advanced analytics',
    description: 'Enable advanced analytics dashboards',
    enabledByDefault: false,
    category: 'analytics',
    isActive: true,
  },
  {
    // БЗ-6 «Паспорта v2» (docs/PASSPORTS-V2.md): справочник «Паспорта», мастер и PDF v2. Выключен — всё как раньше.
    // Включить: PUT /api/feature-flags/passports.v2 { "enabledByDefault": true } (админ)
    key: 'passports.v2',
    label: 'Паспорта v2',
    description: 'Справочник «Паспорта» по категориям, мастер создания и PDF v2',
    enabledByDefault: false,
    category: 'passports',
    isActive: true,
  },
] as const;

@Injectable()
export class FeatureFlagsSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeatureFlagsSeed.name);

  constructor(private readonly flags: FeatureFlagService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const f of DEFAULT_FLAGS) {
      const exists = await this.flags
        .findAll()
        .then((arr) => arr.find((d) => d.key === f.key));
      if (exists) continue;
      try {
        await this.flags.upsert(f.key, {
          label: f.label,
          description: f.description,
          enabledByDefault: f.enabledByDefault,
          category: f.category,
          isActive: f.isActive,
        });
        this.logger.log(`FeatureFlag seeded: ${f.key}`);
      } catch (err) {
        this.logger.warn(`Could not seed FeatureFlag ${f.key}: ${(err as Error).message}`);
      }
    }
  }
}
