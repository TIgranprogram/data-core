import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  ['Зоны ответственности', ['backend/scripts/review-scope.mjs', 'owners', '--all']],
  ['Карта модулей', ['backend/scripts/check-map.mjs']],
  ['Импорты PWA и админки', ['backend/scripts/pwa-import-check.mjs']],
  ['Ограничения дизайна', ['backend/scripts/design-lint.mjs']],
  ['Циклы модулей', ['backend/scripts/audit-cycles.js']],
  ['Границы доменов', ['backend/scripts/audit-domain-boundaries.js']],
  ['Тесты проверок', ['--test',
    'backend/scripts/review-scope.test.mjs',
    'backend/scripts/design-lint.l3.test.mjs',
    'backend/scripts/audit-cycles.test.mjs',
    'backend/scripts/audit-domain-boundaries.test.mjs']],
];

const args = process.argv.slice(2);
if (args.length && (args[0] !== '--range' || args.length !== 2)) {
  console.error('Запуск: node tools/project-guard.mjs [--range FROM..TO]');
  process.exit(2);
}
if (args.length) {
  checks.push(['Подтверждения зон в коммитах', ['backend/scripts/review-scope.mjs', 'owners', '--verify-range', args[1]]]);
}

let failed = 0;
for (const [label, command] of checks) {
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
  if (result.status === 0 && !result.error) continue;
  failed++;
  const reason = result.error?.message || (result.signal ? `сигнал ${result.signal}` : `код ${result.status}`);
  console.error(`FAIL · ${label} · ${reason}\nnode ${command.join(' ')}`);
  for (const output of [result.stdout, result.stderr]) {
    if (output?.trim()) console.error(output.trimEnd());
  }
}

if (failed) {
  console.error(`Проверки проекта FAIL (${failed} из ${checks.length})`);
  process.exitCode = 1;
} else {
  console.log(`Проверки проекта PASS (${checks.length})`);
}
