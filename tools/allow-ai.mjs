// Разрешения ИИ на этом компьютере: `node tools/allow-ai.mjs` запускает пользователь, один раз на ПК.
// Дописывает узкий список в .claude/settings.local.json (файл не в git). Повторный запуск ничего не дублирует.
// Вне списка нарочно: запись на прод, пароли, ssh на серверы, удаление данных.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = '.claude/settings.local.json';
const RULES = [
  'Bash(node tools/dc.mjs *)',
  'Bash(tools/dc.cmd *)',
  'Bash(node tools/night.mjs *)',
  'Bash(node --test tools/*)',
  'Bash(bash SRV-ERP/refresh-copy.sh*)',
  'Bash(docker compose -p dcnight *)',
  'Bash(docker compose -p halab *)',
];

const cfg = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
cfg.permissions ??= {};
const allow = new Set(cfg.permissions.allow ?? []);
const before = allow.size;
for (const r of RULES) allow.add(r);
cfg.permissions.allow = [...allow];
writeFileSync(FILE, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`Готово: добавлено правил ${allow.size - before}, всего ${allow.size}. Файл: ${FILE}`);
