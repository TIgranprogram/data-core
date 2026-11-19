import { dateTime } from './format.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const ARCHIVE = /^datacore-\d{4}-\d{2}-\d{2}_\d{6}\.tgz$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/;

function formatTimestamp(value) {
  const match = typeof value === 'string' && value.match(TIMESTAMP);
  if (!match) return '';
  const day = new Date(match[1] + 'T00:00:00Z');
  const time = new Date(value);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1] || !Number.isFinite(time.getTime())) return '';
  return dateTime(time);
}

/** Публичная метка из локального bind-файла. Запрашивается один раз на документ и переживает смену аккаунта. */
export async function loadDevelopmentMode(pageHref, request = fetch) {
  const page = new URL(pageHref);
  if (!LOOPBACK.has(page.hostname) || !['http:', 'https:'].includes(page.protocol)) return null;

  try {
    const url = new URL('development.json', page);
    const response = await request(url.href, { mode: 'same-origin', cache: 'no-store', redirect: 'error', credentials: 'omit' });
    if (!response.ok) return null;
    const meta = await response.json();
    if (meta?.mode !== 'development' || meta.origin !== page.origin) return null;

    const snapshot = formatTimestamp(meta.data?.snapshotAt);
    const backup = meta.data?.backup;
    const archive = typeof backup === 'string' && ARCHIVE.test(backup) ? backup : 'не указан';
    const restored = formatTimestamp(meta.data?.restoredAt) || 'не указано';
    const built = formatTimestamp(meta.code?.builtAt) || 'не указана';
    return {
      title: 'Разработка · копия данных' + (snapshot ? ' от ' + snapshot : ' · дата неизвестна'),
      sub: `Архив ${archive} · Восстановление ${restored} · Сборка ${built}`,
    };
  } catch {
    return null;
  }
}
