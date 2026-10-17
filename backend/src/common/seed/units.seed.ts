import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { UnitService } from '../../modules/unit/unit.service';

interface SeedUnit {
  key: string;
  label: string;
  symbol?: string;
  category?: string;
  sortOrder: number;
}

const DEFAULT_UNITS: readonly SeedUnit[] = [
  { key: 'pcs',  label: 'Штука',           symbol: 'шт', category: 'count',  sortOrder: 10 },
  { key: 'kg',   label: 'Килограмм',       symbol: 'кг', category: 'mass',   sortOrder: 20 },
  { key: 'm',    label: 'Метр',            symbol: 'м',  category: 'length', sortOrder: 30 },
  { key: 'm2',   label: 'Квадратный метр', symbol: 'м²',  category: 'area',   sortOrder: 40 },
  { key: 'm3',   label: 'Кубический метр', symbol: 'м³',  category: 'volume', sortOrder: 50 },
  { key: 'sheet',label: 'Лист',            symbol: 'л.',  category: 'count',  sortOrder: 60 },
] as const;

@Injectable()
export class UnitsSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnitsSeed.name);

  constructor(private readonly units: UnitService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const u of DEFAULT_UNITS) {
      try {
        await this.units.findByKey(u.key);
      } catch {
        try {
          await this.units.create({
            key: u.key,
            label: u.label,
            symbol: u.symbol,
            category: u.category,
            sortOrder: u.sortOrder,
            isActive: true,
            isSystem: true,
          });
          this.logger.log(`Unit seeded: ${u.key}`);
        } catch (err) {
          this.logger.warn(`Could not seed unit ${u.key}: ${(err as Error).message}`);
        }
      }
    }
  }
}
