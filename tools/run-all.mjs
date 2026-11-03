#!/usr/bin/env node
// Локальный прогон WIP: dc check и все unit инструментов. Docker/production/E2E не вызываются.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSecrets } from '../pult/dispatch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function allSteps(root = ROOT) {
  const tests = fs.readdirSync(path.join(root, 'pult', 'test')).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `pult/test/${name}`);
  return [
    { name: 'Проверка кода (типы, юнит, импорты, дизайн, пульт)', args: ['tools/dc.mjs', 'check'] },
    { name: 'Все юнит-тесты инструментов', args: ['--test', 'tools/dc.test.mjs', 'tools/night.test.mjs', ...tests] },
  ];
}
export function runAll({ root = ROOT, logDir = path.join(root, 'tools', 'logs'), runFn = spawnSync, now = () => new Date(), steps = allSteps(root) } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const started = now().toISOString();
  const logFile = path.join(logDir, `all-run-${started.replace(/[:.]/g, '-')}.log`);
  const summaryFile = path.join(logDir, 'SUMMARY.md');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MONGO|COMPOSE|CONTROL_|DC_PROD)/i.test(key)));
  const rows = [], logs = [];
  let failed = 0, toolError = false;
  for (const step of steps) {
    const r = runFn(process.execPath, step.args, { cwd: root, encoding: 'utf8', env, windowsHide: true, shell: false, timeout: 30 * 60000, maxBuffer: 64 * 1024 * 1024 });
    const code = r.status ?? 2;
    const output = maskSecrets([r.stdout, r.stderr, r.error?.message].filter(Boolean).join('\n'));
    if (code !== 0) failed++;
    if (r.error || r.status == null) toolError = true;
    rows.push(`| ${step.name} | ${code === 0 ? 'ОК' : `код ${code}`} |`);
    logs.push(`=== ${step.name} → код ${code} ===\n${output}\n`);
  }
  const summary = [`# Прогон «Всё сразу» — ${started}`, '', '| Проверка | Итог |', '|--|--|', ...rows, '', `Итог: ${failed ? `${failed} шаг(ов) не прошли` : 'ВСЕ ЗЕЛЁНЫЕ'}`, '', `Полный локальный журнал: ${logFile}`, ''].join('\n');
  fs.writeFileSync(logFile, logs.join('\n') + '\n');
  fs.writeFileSync(summaryFile, summary);
  return { code: toolError ? 2 : failed ? 1 : 0, summary, logFile, summaryFile };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runAll(); console.log(result.summary); process.exitCode = result.code;
}
