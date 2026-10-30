// Разбор ответов doctor.sh: строки ✓ / ⚠ / ✗ и итог. Пороги подобраны под 10 пользователей, без лишней тревоги.
const parse = (k) => { try { return JSON.parse(process.env[k] || ''); } catch { return null; } };
let warn = 0, bad = 0;
const ok = (t) => console.log('✓ ' + t);
const w = (t) => { warn++; console.log('⚠ ' + t); };
const x = (t) => { bad++; console.log('✗ ' + t); };
const gb = (n) => (n / 1e9).toFixed(1) + ' ГБ';

const health = parse('HEALTH');
if (health?.status === 'ok') ok('Сайт и база отвечают'); else x('Сайт: ' + JSON.stringify(health?.error ?? health ?? 'нет ответа').slice(0, 140));
const ver = parse('VERSION');
if (ver?.v) ok(`Версия приложения: ${ver.n ? 'v1.' + ver.n + ' ' : ''}${ver.v}`); else w('Версия приложения не прочитана');

const list = parse('BACKUPS');
const copies = list?.items ?? (Array.isArray(list) ? list : null);
const newest = copies?.map((b) => new Date(b.date ?? 0).getTime()).filter(Boolean).sort((a, b) => b - a)[0];
const hours = newest ? (Date.now() - newest) / 36e5 : null;
if (hours === null) (health?.info?.backup?.status === 'up' ? ok('Бэкап на сервере свежий (по /health)') : x('Бэкап на сервере: нет данных'));
else if (hours > 30) x(`Последний бэкап ${Math.round(hours)} ч назад`);
else ok(`Бэкап на сервере: ${Math.round(hours)} ч назад, копий ${copies.length}`);

const off = parse('OFFSITE');
const targets = off?.targets ?? [];
if (!off) w('Копии вне сервера: нет данных');
else if (!targets.length) w('Копий вне сервера нет: сервер сломается — потеряем и данные, и бэкапы. Настроить: админка → Сервер → Копии вне дома');
else {
  const last = targets.map((t) => new Date(t.lastOkAt ?? t.lastAt ?? 0).getTime()).sort((a, b) => b - a)[0];
  if (Date.now() - last > 2 * 864e5) x('Копия вне сервера старше двух суток'); else ok(`Копии вне сервера: целей ${targets.length}`);
}

const drill = (process.env.DRILL || '').trim().split(/\s+/);
const drillDays = drill[0] ? Math.floor((Date.now() - new Date(drill[0]).getTime()) / 864e5) : null;
if (drillDays === null) w('Учебного восстановления не было: bash deploy/synology/restore-drill.sh на VM');
else if (drill[1] !== 'ok') x('Учебное восстановление не прошло: ' + drill.join(' ').slice(0, 110));
else if (drillDays > 35) w(`Учебное восстановление было ${drillDays} дн. назад`);
else ok(`Учебное восстановление: ${drillDays} дн. назад, успешно`);

const d = parse('DISK');
if (!d?.totalBytes) w('Диск: нет данных');
else if (d.usedPct >= 90) x(`Диск занят на ${d.usedPct} %`);
else if (d.usedPct >= 80) w(`Диск занят на ${d.usedPct} %, свободно ${gb(d.freeBytes)}`);
else ok(`Диск: занято ${d.usedPct} %, свободно ${gb(d.freeBytes)}`);
const cache = (process.env.CACHE || '').split('=')[1];
if (!cache) w('Кэш сборки Docker: нет связи по ssh');
else if (/GB/.test(cache) && parseFloat(cache) > 15) w(`Кэш сборки ${cache}: уменьшится при следующей выкладке`);
else ok(`Кэш сборки Docker: ${cache}`);

const errs = parse('ERRORS')?.items;
if (!errs) w('Ошибки сайта: нет данных');
else {
  const real = errs.filter((e) => e.name !== 'SlowScreen' && !/Нет связи/.test(e.message));
  const cur = real.filter((e) => ver?.v && String(e.version || '').startsWith(ver.v));
  if (cur.length) x(`Ошибки в текущей версии: ${cur.length} групп. Первая: ${String(cur[0].message).slice(0, 90)} (${cur[0].section || '-'})`);
  else if (real.length) w(`Ошибки за сутки в старых версиях: ${real.length} групп`);
  else ok('Ошибок сайта за сутки нет');
  const slow = errs.filter((e) => e.name === 'SlowScreen' && e.count >= 3);
  if (slow.length) w('Часто медленно: ' + slow.map((e) => `${e.section} ×${e.count}`).join(', '));
}

const integ = parse('INTEGRITY');
if (!integ) w('Целостность склада: нет данных');
else if (integ.issues?.length) x(`Целостность склада: проблем ${integ.issues.length}. Первая: ${JSON.stringify(integ.issues[0]).slice(0, 110)}`);
else ok('Целостность склада: проблем нет');

const slowR = parse('SLOW');
const routes = (slowR?.items ?? []).filter((r) => r.maxMs > 5000);
if (routes.length) w('Запросы дольше 5 с: ' + routes.slice(0, 4).map((r) => r.route).join(', '));

console.log(bad ? `ИТОГ: чинить сейчас — ${bad}, посмотреть — ${warn}` : warn ? `ИТОГ: работает, посмотреть — ${warn}` : 'ИТОГ: всё в норме');
process.exit(bad ? 1 : 0);
