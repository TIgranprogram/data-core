// Сверка каталога с проектом. Новый скрипт без кнопки и без причины в NOT_ON_BUTTONS — находка:
// её показывает полоса в окне пульта и роняет pult/test (а значит и `dc check`).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './dispatch.mjs';

const WATCHED = ['deploy/backup-pull', 'deploy/synology', 'remote-access', 'SRV-ERP', 'tools', 'tools/kit'];
const SCRIPT = /\.(sh|cmd|ps1|mjs|js|py)$/;

export function scriptsOnDisk(root = ROOT) {
  const out = [];
  for (const d of WATCHED) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && SCRIPT.test(e.name) && !e.name.includes('.test.')) out.push(`${d}/${e.name}`);
    }
  }
  return out.sort();
}

/** Пути скриптов, на которые ссылается запись каталога. */
function scriptsOf(cmd) {
  const r = cmd.run;
  const list = [...(r.node || []), ...(r.bash || []), ...(r.cmd || []), ...(r.powershell || [])];
  return list.map((s) => s.replace(/\\/g, '/')).filter((s) => SCRIPT.test(s) && !s.includes('*'));
}

/** Подкоманды из таблицы main() в tools/dc.mjs. */
export function dcSubcommands(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'tools', 'dc.mjs'), 'utf8');
  const names = [...src.matchAll(/^\s{6}(\w+): \(\) =>/gm)].map((m) => m[1]);
  return src.includes("cmd === 'logs'") ? [...names, 'logs'] : names;
}

/** Итог сверки: пустые списки — каталог совпадает с проектом. */
export function auditCatalog({ COMMANDS, NOT_ON_BUTTONS }, root = ROOT) {
  const disk = scriptsOnDisk(root);
  const used = new Set(COMMANDS.flatMap(scriptsOf));
  const dcButtons = new Set(COMMANDS.filter((c) => c.run.node?.[0] === 'tools/dc.mjs').map((c) => c.run.node[1]));
  return {
    noButton: disk.filter((s) => !used.has(s) && !(s in NOT_ON_BUTTONS)),
    staleButton: [...used].filter((s) => !fs.existsSync(path.join(root, s))),
    staleExcuse: Object.keys(NOT_ON_BUTTONS).filter((s) => !fs.existsSync(path.join(root, s))),
    noDcButton: dcSubcommands(root).filter((s) => !dcButtons.has(s)),
  };
}

export const auditProblems = (a) => [
  ...a.noButton.map((s) => `Скрипт без кнопки: ${s}`),
  ...a.staleButton.map((s) => `Кнопка ведёт на удалённый файл: ${s}`),
  ...a.staleExcuse.map((s) => `В NOT_ON_BUTTONS остался удалённый файл: ${s}`),
  ...a.noDcButton.map((s) => `Команда dc без кнопки: ${s}`),
];
