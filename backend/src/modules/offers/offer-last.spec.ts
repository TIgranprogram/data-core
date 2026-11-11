import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import { CreateOfferDto } from './dto';
import { customerNameRegex, pickLastOffer, presentLastOffer, type LastOfferRow } from './offer-last';
import { OffersService } from './offers.service';

const row = (p: Partial<LastOfferRow> & { _id: string }): LastOfferRow => ({ status: 'draft', customer: 'ООО Школа', date: '2026-11-01', ...p });

describe('C073: последнее КП заказчику', () => {
  const id = new Types.ObjectId().toHexString();

  it('берёт более позднее, отменённое и удалённое пропускает', () => {
    const rows = [
      row({ _id: '1', date: '2026-11-01', terms: 'старые' }),
      row({ _id: '2', customer: 'ооо   школа', date: '2026-11-10', terms: 'новые' }),
      row({ _id: '3', date: '2026-11-20', status: 'cancelled', terms: 'отмена' }),
      row({ _id: '4', date: '2026-11-15', deletedAt: new Date(), terms: 'удалено' }),
    ];
    expect(pickLastOffer(rows, { customer: 'ООО Школа' })?._id).toBe('2');
  });

  it('нет живого КП — null', () => {
    expect(pickLastOffer([], { customer: 'ООО Школа' })).toBeNull();
    expect(pickLastOffer([row({ _id: '1', status: 'cancelled' })], { customer: 'ООО Школа' })).toBeNull();
    expect(pickLastOffer([row({ _id: '1' })], { customer: '   ' })).toBeNull();
  });

  it('название без регистра и лишних пробелов; id контрагента важнее названия', () => {
    const re = customerNameRegex('ООО  Школа');
    expect(re?.test('ооо школа')).toBe(true);
    expect(re?.test('  ООО   Школа ')).toBe(true);
    expect(re?.test('ООО Школа-2')).toBe(false);
    expect(customerNameRegex('   ')).toBeNull();
    const byId = row({ _id: '9', customer: 'Другой', counterpartyId: id, date: '2026-11-01' });
    const byName = row({ _id: '8', customer: 'ООО Школа', date: '2026-11-20' });
    expect(pickLastOffer([byName, byId], { customer: 'ООО Школа', counterpartyId: id })?._id).toBe('9');
    const older = row({ _id: '1', counterpartyId: id, date: '2026-11-01' });
    const newer = row({ _id: '2', counterpartyId: id, date: '2026-11-09' });
    expect(pickLastOffer([older, newer], { counterpartyId: id })?._id).toBe('2');
  });

  it('цены строк: по изделию, повтор — последняя цена', () => {
    const pid = new Types.ObjectId().toHexString();
    const r = presentLastOffer(row({
      _id: '1', number: 'КП-2026-2', objectName: 'Мост', prepaymentPercent: 30,
      items: [{ productId: pid, unitPrice: 1000 }, { productId: pid, unitPrice: 15000 }, { unitPrice: 5 }],
    }));
    expect(r).toMatchObject({ offerId: '1', number: 'КП-2026-2', objectName: 'Мост', prices: [{ productId: pid, unitPrice: 15000 }] });
  });

  it('DTO не отбрасывает counterpartyId и description', async () => {
    const oid = new Types.ObjectId().toHexString();
    const dto = plainToInstance(CreateOfferDto, {
      companyId: oid, customer: 'А', counterpartyId: oid,
      items: [{ productName: 'Урна', quantity: 1, description: 'Для двора' }],
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.counterpartyId).toBe(oid);
    expect(dto.items[0].description).toBe('Для двора');
  });
});

describe('OffersService.last', () => {
  const oid = new Types.ObjectId();
  const doc = {
    _id: oid, number: 'КП-2026-2', date: new Date('2026-11-10'), customer: 'ООО Школа', status: 'draft',
    objectName: 'Мост', terms: 'Предоплата', prepaymentPercent: 30, productionDays: 20, deliveryDays: 5,
    delivery: 'included', vatMode: 'with', vatRate: 22,
    items: [{ productId: oid, unitPrice: 15000 }],
  };

  function make(rows: unknown[]) {
    const exec = jest.fn(async () => rows);
    const sort = jest.fn(() => ({ limit: () => ({ lean: () => ({ exec }) }) }));
    const find = jest.fn(() => ({ sort }));
    const svc = new OffersService({} as never, { find } as never, {} as never, {} as never, {} as never, {} as never);
    return { svc, find, sort };
  }

  it('пустой запрос — null и без запроса в базу', async () => {
    const { svc, find } = make([]);
    expect(await svc.last({})).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('нет КП — null', async () => {
    const { svc } = make([]);
    expect(await svc.last({ customer: 'Нет такого' })).toBeNull();
  });

  it('отдаёт поля последнего и сортирует по дате', async () => {
    const { svc, find, sort } = make([doc]);
    const r = await svc.last({ customer: 'ооо  школа' });
    const filter = (find.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(filter.status).toEqual({ $ne: 'cancelled' });
    expect(sort).toHaveBeenCalledWith({ date: -1, createdAt: -1, _id: -1 });
    expect(r).toMatchObject({
      offerId: String(oid), number: 'КП-2026-2', objectName: 'Мост', terms: 'Предоплата',
      prepaymentPercent: 30, productionDays: 20, deliveryDays: 5, delivery: 'included',
      prices: [{ productId: String(oid), unitPrice: 15000 }],
    });
  });
});
