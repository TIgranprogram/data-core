import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CurrencyService } from '../../modules/currency/currency.service';
import { Currency, CurrencyDocument } from '../../modules/currency/currency.schema';

interface SeedCurrency {
  key: string;
  label: string;
  code: string;
  symbol: string;
  rate: number;
  isBase: boolean;
  locale: string;
  precision: number;
  sortOrder: number;
}

const DEFAULT_CURRENCIES: readonly SeedCurrency[] = [
  { key: 'RUB', label: 'Российский рубль', code: '643', symbol: '₽', rate: 1.0, isBase: true, locale: 'ru-RU', precision: 2, sortOrder: 10 },
] as const;

const LEGACY_CURRENCY_KEYS = ['USD', 'EUR'] as const;

@Injectable()
export class CurrenciesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(CurrenciesSeed.name);

  constructor(
    private readonly currencies: CurrencyService,
    @InjectModel(Currency.name) private readonly currencyModel: Model<CurrencyDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.currencyModel
      .updateMany(
        { key: { $in: LEGACY_CURRENCY_KEYS }, isActive: true },
        { $set: { isActive: false } },
      )
      .exec();

    for (const c of DEFAULT_CURRENCIES) {
      try {
        const exists = await this.currencyModel.findOne({ key: c.key }).exec();
        if (exists) continue;
        await this.currencies.create({
          key: c.key,
          label: c.label,
          code: c.code,
          symbol: c.symbol,
          rate: c.rate,
          isBase: c.isBase,
          locale: c.locale,
          precision: c.precision,
          sortOrder: c.sortOrder,
          isActive: true,
          isSystem: true,
        });
        this.logger.log(`Currency seeded: ${c.key}`);
      } catch (err) {
        this.logger.warn(`Could not seed currency ${c.key}: ${(err as Error).message}`);
      }
    }
  }
}
