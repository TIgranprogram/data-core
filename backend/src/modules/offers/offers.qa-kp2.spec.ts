import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import { UpdateOfferDto } from './dto';
import { OffersService } from './offers.service';
import { vatAmount } from './offer-rules';

/** QA КП-2: сброс полей через null, НДС 22 %, DTO принимает null. */
describe('КП-2: PATCH сбрасывает поля (QA)', () => {
  const company = new Types.ObjectId();
  const cur = { _id: new Types.ObjectId(), number: 'КП-1', date: new Date('2026-11-06'), companyId: company, customer: 'X', status: 'draft', delivery: 'included', vatMode: 'with', vatRate: 22, objectName: 'Мост', items: [], total: 0 };
  const coll = () => ({ findOne: async () => ({ _id: company, name: 'Ф', vatRate: 22 }), find: () => ({ toArray: async () => [] }) });
  let updateOne: jest.Mock;
  let svc: OffersService;
  beforeEach(() => {
    updateOne = jest.fn(() => ({ exec: async () => ({}) }));
    const model = { findOne: () => ({ lean: () => ({ exec: async () => cur }) }), updateOne };
    svc = new OffersService({ db: { collection: coll } } as never, model as never, {} as never, {} as never, {} as never, {} as never);
  });

  it('DTO пропускает null в delivery / vatMode / vatRate / objectName', async () => {
    const dto = plainToInstance(UpdateOfferDto, { delivery: null, vatMode: null, vatRate: null, objectName: null });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('DTO отклоняет мусор в delivery и ставку > 30', async () => {
    const dto = plainToInstance(UpdateOfferDto, { delivery: 'maybe', vatRate: 31 });
    expect((await validate(dto)).length).toBe(2);
  });

  it('delivery:null и vatMode:null кладут null в $set', async () => {
    await svc.update(String(cur._id), { delivery: null, vatMode: null, vatRate: null, objectName: null } as never);
    const set = updateOne.mock.calls[0][1].$set;
    expect(set).toMatchObject({ delivery: null, vatMode: null, vatRate: null, objectName: null });
  });

  it('НДС 22 % от 680 000 = 122 622,95', () => {
    expect(vatAmount(680000, 22)).toBe(122622.95);
  });
});
