import { Model } from 'mongoose';
import { CurrencyService } from '../../modules/currency/currency.service';
import { CurrencyDocument } from '../../modules/currency/currency.schema';
import { CurrenciesSeed } from './currencies.seed';

describe('CurrenciesSeed', () => {
  const create = jest.fn();
  const findOne = jest.fn();
  const updateMany = jest.fn();
  const currencyService = { create } as unknown as CurrencyService;
  const currencyModel = {
    findOne,
    updateMany,
  } as unknown as Model<CurrencyDocument>;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ key: 'RUB' });
    findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    updateMany.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 }),
    });
  });

  it('seeds only RUB and deactivates legacy USD/EUR without deleting them', async () => {
    const seed = new CurrenciesSeed(currencyService, currencyModel);

    await seed.onApplicationBootstrap();

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ key: 'RUB' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'RUB', isBase: true, isActive: true }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      { key: { $in: ['USD', 'EUR'] }, isActive: true },
      { $set: { isActive: false } },
    );
  });

  it('does not recreate RUB or legacy currencies on repeated bootstrap', async () => {
    findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ key: 'RUB', isActive: true }),
    });
    const seed = new CurrenciesSeed(currencyService, currencyModel);

    await seed.onApplicationBootstrap();
    await seed.onApplicationBootstrap();

    expect(create).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
