import { Types } from 'mongoose';
import { backupReminder } from './backup-reminder';

/** Память вместо Mongo: auditlogs и devlog_releases. */
function fakeDb(audit: Array<{ createdAt: Date }>, releases: Array<{ date: Date }>) {
  const coll = (name: string) => {
    const rows = name === 'auditlogs' ? audit : releases;
    return {
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [...rows].sort((a, b) => ((b as { createdAt?: Date; date?: Date }).createdAt ?? (b as { date: Date }).date).getTime() - ((a as { createdAt?: Date; date?: Date }).createdAt ?? (a as { date: Date }).date).getTime()).slice(0, 1) }) }) }),
      countDocuments: async (f: { date?: { $gt: Date } }) => releases.filter((r) => !f.date || r.date > f.date.$gt).length,
    };
  };
  return { collection: coll } as never;
}

describe('backupReminder', () => {
  const uid = String(new Types.ObjectId());
  const rel = [new Date('2026-11-01'), new Date('2026-11-03'), new Date('2026-11-05')].map((date) => ({ date }));
  it('считает выпуски после последнего скачивания', async () => {
    const r = await backupReminder(fakeDb([{ createdAt: new Date('2026-10-20') }, { createdAt: new Date('2026-11-02') }], rel), uid);
    expect(r).toEqual({ lastDownloadAt: new Date('2026-11-02'), releasesSince: 2, lastReleaseAt: new Date('2026-11-05') });
  });
  it('скачивания не было — дата null, все выпуски', async () => {
    const r = await backupReminder(fakeDb([], rel), uid);
    expect(r).toMatchObject({ lastDownloadAt: null, releasesSince: 3 });
  });
  it('нет пользователя — как «не скачивал»', async () => {
    expect((await backupReminder(fakeDb([{ createdAt: new Date() }], rel))).lastDownloadAt).toBeNull();
  });
});
