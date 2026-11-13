#!/usr/bin/env node
// Автоуборка этого ПК (владелец 2026-11-13: «чтобы гигабайты не копились — дома и на работе, само»).
//   node tools/pc-clean.mjs           убрать (по умолчанию)
//   node tools/pc-clean.mjs --plan    только показать, что уберётся
// Запускается сама: пульт раз в день (SCHEDULE pc-clean) и в конце смены Старожила.
// Что убирает — только мусор этого ПК, в git ничего не меняет:
//   1. Docker: кэш сборки, ничьи образы и тома, старые стенды (tools/docker-clean.mjs --clean; текущий стенд и локальный сайт не трогает).
//      Пока работает тестировщик или Старожил — Docker пропускается.
//   2. tools/logs: файлы и папки старше 30 дней.
//   3. Брошенные профили браузера (edge-smoke-*, ai-tester-*) старше 6 ч.
//   4. Папки, удалённые из проекта, если остались на диске: tests_ai_tiit, db_ai, «для анализа».
//   5. Копии базы D:\datacore-backups: только самая свежая.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = process.argv.includes('--plan');
const DAY = 86400000;
const say = (s) => console.log(s);

/** Что удалить из списка {path, mtime, kind}: чистое правило, проверяется тестом. */
export function pickOld(entries, now, maxAgeMs, keep = () => false) {
  return entries.filter((e) => !keep(e) && now - e.mtime > maxAgeMs).map((e) => e.path);
}
/** Копии базы: оставить только самую свежую по имени datacore-ГГГГ-ММ-ДД_ЧЧММСС.tgz. */
export function oldCopies(names) {
  const tgz = names.filter((n) => /^datacore-\d{4}-\d{2}-\d{2}_\d{6}\.tgz$/.test(n)).sort();
  return tgz.slice(0, -1);
}

const list = (dir) => { try { return fs.readdirSync(dir).map((n) => { const p = path.join(dir, n); const st = fs.statSync(p); return { path: p, mtime: st.mtimeMs, dir: st.isDirectory() }; }); } catch { return []; } };
const size = (p) => { try { const st = fs.statSync(p); if (!st.isDirectory()) return st.size; return fs.readdirSync(p).reduce((s, n) => s + size(path.join(p, n)), 0); } catch { return 0; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const busy = (f) => { try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); return r.pid && alive(r.pid) && Date.now() - (r.beat || 0) < 25 * 60000; } catch { return false; } };

export function main(now = Date.now()) {
  const drop = [];
  // 2. журналы
  const logs = path.join(ROOT, 'tools', 'logs');
  const keepLog = (e) => /(^|[\\/])(run\.json|created\.json|history\.json|last\.json|last-shift\.md|STOP)$/.test(e.path);
  drop.push(...pickOld(list(logs), now, 30 * DAY, keepLog));
  for (const sub of ['ai-tester', 'starozhil', 'design-vision']) drop.push(...pickOld(list(path.join(logs, sub)), now, 30 * DAY, keepLog));
  // 3. профили браузера
  for (const st of list(path.join(ROOT, 'tools', '.night', 'stands')).filter((e) => e.dir)) drop.push(...pickOld(list(st.path).filter((e) => /edge-smoke-/.test(e.path)), now, 6 * 3600000));
  drop.push(...pickOld(list(os.tmpdir()).filter((e) => /[\\/](ai-tester-|edge-smoke-)/.test(e.path)), now, 6 * 3600000));
  // 4. удалённые из проекта папки (в git их уже нет)
  for (const n of ['tests_ai_tiit', 'db_ai', 'для анализа']) {
    const p = path.join(ROOT, n);
    const tracked = spawnSync('git', ['ls-files', '--', n], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim();
    if (fs.existsSync(p) && !tracked) drop.push(p);
  }
  // 5. копии базы
  const bak = process.env.DATACORE_BACKUPS || 'D:\\datacore-backups';
  drop.push(...oldCopies(list(bak).map((e) => path.basename(e.path))).map((n) => path.join(bak, n)));

  let freed = 0; let left = 0;
  for (const p of drop) {
    const s = size(p);
    if (PLAN) { say(`  уберу: ${path.relative(ROOT, p).startsWith('..') ? p : path.relative(ROOT, p)} (${Math.round(s / 1048576)} МБ)`); freed += s; continue; }
    try { fs.rmSync(p, { recursive: true, force: true }); freed += s; } catch { left++; }
  }
  say(`Файлы: ${PLAN ? 'можно убрать' : 'убрано'} ${drop.length - left} (${Math.round(freed / 1048576)} МБ)${left ? `, заняты Windows: ${left}` : ''}.`);

  // 1. Docker — последним и только когда стенд никто не использует
  const docker = spawnSync('docker', ['info'], { encoding: 'utf8', windowsHide: true }).status === 0;
  if (!docker) say('Docker: не запущен — пропуск.');
  else if (busy(path.join(logs, 'ai-tester', 'run.json')) || (!process.argv.includes('--from-shift') && busy(path.join(logs, 'starozhil', 'run.json')))) say('Docker: работает тестировщик или Старожил — пропуск до следующей уборки.');
  else {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'docker-clean.mjs'), ...(PLAN ? [] : ['--clean'])], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 15 * 60000 });
    say('Docker: ' + ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-4).join(' · '));
    // хвосты наших старых проверок: «ночная смена» (удалена 13.11) и временные QA-базы задач (cNNN-qa-*) старше 2 дней.
    // Чужие проекты (например, odr) — не трогаем.
    const out = (args) => (spawnSync('docker', args, { encoding: 'utf8', windowsHide: true }).stdout || '').trim().split('\n').filter(Boolean);
    const qaBox = out(['ps', '-a', '--filter', 'name=-qa-', '--format', '{{.Names}}\t{{.CreatedAt}}']).map((l) => l.split('\t'))
      .filter(([n, at]) => /^c\d{3}-qa-/.test(n) && now - Date.parse(String(at).slice(0, 19)) > 2 * DAY).map(([n]) => n);
    const vols = out(['volume', 'ls', '--format', '{{.Name}}']).filter((v) => /^(nightshift_|nsqa-|c\d{3}-qa-)/.test(v));
    if (!PLAN) {
      if (qaBox.length) spawnSync('docker', ['rm', '-f', ...qaBox], { windowsHide: true });
      for (const v of vols) spawnSync('docker', ['volume', 'rm', v], { windowsHide: true }); // занятый том Docker не удалит — это и нужно
    }
    if (qaBox.length || vols.length) say(`Docker: старые проверки — контейнеров ${qaBox.length}, томов ${vols.length} ${PLAN ? 'к уборке' : 'убрано (занятые оставлены)'}.`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
