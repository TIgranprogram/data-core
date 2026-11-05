/**
 * Проверка «перед --apply есть свежий бэкап» (метка — папка mongo-* в каталоге бэкапов, её делает deploy/synology/backup.sh).
 * Каталог — переменная BACKUP_DIR; свежесть — BACKUP_MAX_HOURS (по умолчанию 24).
 * Возвращает { ok, text }: text — что показать человеку.
 */
const fs = require('fs');
const path = require('path');

function backupFresh() {
  const dir = process.env.BACKUP_DIR;
  const hours = Number(process.env.BACKUP_MAX_HOURS || 24);
  if (!dir) return { ok: false, text: 'Не задан BACKUP_DIR (каталог бэкапов, где лежат mongo-…). Сначала сделайте бэкап: deploy/synology/backup.sh' };
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith('mongo-')); } catch { return { ok: false, text: `Каталог бэкапов не читается: ${dir}` }; }
  const times = names.map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!times.length) return { ok: false, text: `В ${dir} нет бэкапов mongo-… — сначала deploy/synology/backup.sh` };
  const age = (Date.now() - times[0].t) / 3600000;
  if (age > hours) return { ok: false, text: `Последний бэкап ${times[0].n} старше ${hours} ч (${Math.round(age)} ч) — сделайте свежий` };
  return { ok: true, text: `Бэкап ${times[0].n}, ${Math.round(age * 10) / 10} ч назад` };
}

module.exports = { backupFresh };
