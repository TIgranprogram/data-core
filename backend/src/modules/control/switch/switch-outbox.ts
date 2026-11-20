import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { SwitchJob } from './switch.rules';

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

function idFrom(text: string): string | undefined {
  return /^id=([0-9a-f]+)\r?$/m.exec(text)?.[1];
}

/** Не переписываем запрос или работу, уже принятую хостом. */
export async function bridgeFiles(dir: string, id?: string): Promise<'available' | 'elsewhere' | 'delivered'> {
  // Мост записывает current до удаления request, last-id — до завершения работы.
  const request = await readOptional(path.join(dir, 'request'));
  const current = await readOptional(path.join(dir, 'current'));
  if (id && [request, current].some((file) => file !== null && idFrom(file) === id)) return 'delivered';
  if (request !== null || current !== null) return 'elsewhere';
  if (id && (await readOptional(path.join(dir, 'last-id')))?.trim() === id) return 'delivered';
  return 'available';
}

export class RequestNotPublished extends Error {
  constructor(readonly cause: unknown) {
    super('Не удалось записать файл заявки');
  }
}

/** Публикуем завершённый файл атомарно, включая гонку со вторым процессом. */
export async function publishBridgeRequest(dir: string, job: SwitchJob): Promise<boolean> {
  const state = await bridgeFiles(dir, job.id);
  if (state !== 'available') return state === 'delivered';
  const kind = job.direction === 'refresh' || job.direction === 'emergency' ? job.direction : 'switch';
  const lines = ['id=' + job.id, 'kind=' + kind, 'requestedAt=' + job.startedAt];
  if (job.refreshScope === 'data') lines.push('code=0');
  if (job.scheduleExpiresAt) lines.push('expiresAt=' + job.scheduleExpiresAt);
  const request = path.join(dir, 'request');
  const temp = request + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, lines.join('\n') + '\n', { mode: 0o644, flag: 'wx' });
    const updated = await bridgeFiles(dir, job.id);
    if (updated !== 'available') return updated === 'delivered';
    try {
      await fs.link(temp, request);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return (await bridgeFiles(dir, job.id)) === 'delivered';
    }
    return true;
  } catch (error) {
    if ((await bridgeFiles(dir, job.id)) === 'available') throw new RequestNotPublished(error);
    throw error;
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}
