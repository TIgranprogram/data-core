import { Types, type Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

export interface BackupReminder {
  /** Когда этот администратор последний раз скачал копию (журнал `backup.download`); null — ни разу. */
  lastDownloadAt: Date | null;
  /** Сколько выпусков сайта вышло после этой копии (если копии не было — всего выпусков). */
  releasesSince: number;
  /** Дата последнего выпуска сайта; null — выпусков нет. */
  lastReleaseAt: Date | null;
}

/** Напоминание «сохраните свежую копию на компьютер»: дата последнего скачивания этим пользователем против выпусков сайта. */
export async function backupReminder(db: Db, userId?: string): Promise<BackupReminder> {
  const last = userId && Types.ObjectId.isValid(userId)
    ? await db.collection('auditlogs').find({ action: 'backup.download', userId: new Types.ObjectId(userId) }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray()
    : [];
  const lastDownloadAt = (last[0]?.createdAt as Date | undefined) ?? null;
  const releases = db.collection('devlog_releases');
  const [releasesSince, newest] = await Promise.all([
    releases.countDocuments(lastDownloadAt ? { date: { $gt: lastDownloadAt } } : {}),
    releases.find({}, { projection: { date: 1 } }).sort({ date: -1 }).limit(1).toArray(),
  ]);
  return { lastDownloadAt, releasesSince, lastReleaseAt: (newest[0]?.date as Date | undefined) ?? null };
}
