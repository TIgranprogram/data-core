import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { FeatureFlagService } from '../../modules/feature-flag/feature-flag.service';
import { MATERIAL_CARD_API_FLAG } from '../../modules/material/material-card-flag';
import { WAREHOUSE_API_FLAG } from '../../modules/stock/warehouse-flag';
import { SUPPLY_REQUEST_API_FLAG } from '../../modules/supply/supply-request-flag';

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
    key: WAREHOUSE_API_FLAG,
    label: 'Склады пишет API',
    description: 'Включён — хозяин записи warehouses это API data-core. Выключен — CRM снова может писать Mongo; POST/PATCH/DELETE /api/stock/warehouses остаются и отвечают 409.',
    enabledByDefault: false,
    category: 'stock',
    isActive: true,
  },
  {
    key: MATERIAL_CARD_API_FLAG,
    label: 'Карточку материала пишет API',
    description: 'Включён — хозяин записи карточки materials это API data-core. Выключен — CRM снова может писать Mongo; POST/PATCH/DELETE /api/materials остаются и отвечают 409. Остаток, история цен, состав и паспорт флаг не смотрит.',
    enabledByDefault: false,
    category: 'stock',
    isActive: true,
  },
  {
    key: SUPPLY_REQUEST_API_FLAG,
    label: 'Заявку пишет API',
    description: 'Включён — хозяин записи заявки supplyrequests это API data-core. Выключен — CRM снова может писать Mongo; POST/PATCH/DELETE /api/supply/requests остаются и отвечают 409. Приход и откат прихода флаг не смотрит.',
    enabledByDefault: false,
    category: 'supply',
    isActive: true,
  },
  // «Паспорта v2» больше не флаг: с 2026-10-23 это единственный вид паспорта (БЗ-7 шаг 1б); запись в базе ни на что не влияет
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
