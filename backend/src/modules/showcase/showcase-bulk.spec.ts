import { Types } from 'mongoose';
import { ShowcaseBulk, type BulkHost } from './showcase-bulk';

/** Массовая правка паспортных полей (C079): пользователей, возраст, рост, вес, конструкция, разборное. */
describe('ShowcaseBulk — значения паспорта по умолчанию', () => {
  const id = new Types.ObjectId().toHexString();
  const make = (raw: Record<string, unknown>) => {
    const saved: Array<Record<string, unknown>> = [];
    const host = {
      db: () => ({ collection: () => ({ findOne: async () => ({ _id: new Types.ObjectId(id), ...raw }) }) }),
      present: async () => [{ type: null, group: null }],
      update: async () => ({}),
      setPassportDefaults: async (_id: string, v: Record<string, unknown>) => { saved.push(v); },
    } as unknown as BulkHost;
    return { bulk: new ShowcaseBulk(host), saved };
  };

  it('дополняет паспортные числа, конструкцию и «разборное», не стирая прочее', async () => {
    const { bulk, saved } = make({ passportDefaults: { warrantyMonths: 12, ageFrom: 3 } });
    const r = await bulk.run({ ids: [id], set: { passportDefaults: { maxUsers: 4, ageFrom: 7, ageTo: 14, heightMin: 120, weightMax: 80, joints: ['bolts', 'welds'], isKit: true } } });
    expect(r.updated).toBe(1);
    expect(r.failed).toEqual([]);
    expect(saved[0]).toMatchObject({ warrantyMonths: 12, maxUsers: 4, ageFrom: 7, ageTo: 14, heightMin: 120, weightMax: 80, joints: ['bolts', 'welds'], isKit: true });
  });

  it('прежнее значение сохраняется в before для «Отменить»', async () => {
    const { bulk } = make({ passportDefaults: { ageFrom: 3 } });
    const r = await bulk.run({ ids: [id], set: { passportDefaults: { ageFrom: 5 } } });
    expect(r.before[0].set.passportDefaults).toEqual({ ageFrom: 3 });
  });
});
