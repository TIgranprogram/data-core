import { DiskService } from './disk.controller';

jest.mock('./disk-fs', () => ({ dirSize: jest.fn(async () => ({ bytes: 5, files: 1 })), exists: jest.fn(async () => false) }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dirSize } = require('./disk-fs') as { dirSize: jest.Mock };

describe('HARDEN-1 п.18: диск — тяжёлые части раз в час', () => {
  it('второй запрос подряд не обходит папки заново', async () => {
    const coll = { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }), updateOne: async () => ({}) };
    const svc = new DiskService({ db: { collection: () => coll, stats: async () => ({ storageSize: 1, indexSize: 2 }) } } as never);
    const a = await svc.usage();
    const calls = dirSize.mock.calls.length;
    const b = await svc.usage();
    expect(dirSize.mock.calls.length).toBe(calls);
    expect(b.parts).toEqual(a.parts);
    expect(a.parts.mongoBytes).toBe(3);
  });
  it('через час считается заново', async () => {
    const coll = { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }), updateOne: async () => ({}) };
    const svc = new DiskService({ db: { collection: () => coll, stats: async () => ({}) } } as never);
    await svc.usage();
    const calls = dirSize.mock.calls.length;
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 3600_001);
    await svc.usage();
    expect(dirSize.mock.calls.length).toBeGreaterThan(calls);
    jest.restoreAllMocks();
  });
});
