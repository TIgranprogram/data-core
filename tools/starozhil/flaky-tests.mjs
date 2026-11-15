#!/usr/bin/env node
// Старожил Р5 (C125): нестабильные юнит-тесты — программой, без ИИ. Прогоняет весь юнит N раз подряд (по умолчанию 3)
// и пишет, какие тесты падали хоть раз, а не каждый раз — это «флаки» (14.11: control.service.spec упал под нагрузкой).
//   node tools/starozhil/flaky-tests.mjs [N]  → tools/logs/starozhil/flaky/FACTS.md
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', 'flaky');
const N = Math.max(2, Math.min(5, Number(process.argv[2]) || 3));
fs.mkdirSync(OUT, { recursive: true });

const fails = new Map(); // «файл › тест» → { n, msg }
const runs = [];
for (let i = 1; i <= N; i++) {
  const json = path.join(OUT, `run-${i}.json`);
  const t0 = Date.now();
  spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['jest', '--silent', '--json', '--outputFile', json], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 256 * 1024 * 1024 });
  let r = null; try { r = JSON.parse(fs.readFileSync(json, 'utf8')); } catch { /* прогон не дал отчёта */ }
  runs.push({ i, ms: Date.now() - t0, total: r?.numTotalTests ?? '?', failed: r?.numFailedTests ?? '?' });
  for (const suite of r?.testResults || []) {
    const file = path.relative(ROOT, suite.name).replace(/\\/g, '/');
    for (const a of suite.assertionResults || []) {
      if (a.status !== 'failed') continue;
      const k = `${file} › ${a.fullName}`;
      const was = fails.get(k) || { n: 0, msg: '' };
      fails.set(k, { n: was.n + 1, msg: was.msg || String((a.failureMessages || [])[0] || '').split('\n')[0].slice(0, 200) });
    }
    if (suite.status === 'failed' && !(suite.assertionResults || []).length) {
      const k = `${file} › (набор не запустился)`; const was = fails.get(k) || { n: 0, msg: '' };
      fails.set(k, { n: was.n + 1, msg: String(suite.message || '').split('\n')[0].slice(0, 200) });
    }
  }
}

const L = [`# Нестабильные юнит-тесты — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '', `Прогонов: ${N}.`, ''];
for (const r of runs) L.push(`- прогон ${r.i}: тестов ${r.total}, упало ${r.failed}, ${Math.round(r.ms / 1000)} с`);
const flaky = [...fails].filter(([, v]) => v.n < N);
const always = [...fails].filter(([, v]) => v.n === N);
L.push('', `## Флаки (падали не каждый раз): ${flaky.length}`, '');
for (const [k, v] of flaky) L.push(`- ${k} — упал ${v.n} из ${N}: ${v.msg}`);
L.push('', `## Падают всегда (это не флаки — сломано): ${always.length}`, '');
for (const [k, v] of always) L.push(`- ${k}: ${v.msg}`);
fs.writeFileSync(path.join(OUT, 'FACTS.md'), L.join('\n') + '\n');
console.log(`Флаки: ${flaky.length}, падают всегда: ${always.length} → tools/logs/starozhil/flaky/FACTS.md`);
