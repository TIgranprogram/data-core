// Очистка Docker: старые стенды, кэш сборки, ничьи образы и тома.
//   node tools/docker-clean.mjs            — план на этом ПК (ничего не удаляет)
//   node tools/docker-clean.mjs --clean    — удалить лишнее на этом ПК
//   node tools/docker-clean.mjs --server [--clean] — то же для сервера (ssh datacore-vm)
// Оставляет всегда: локальный сайт (datacore-*, проект data-core, данные в .data/), текущий стенд :3102
// (tools/.night/current-stand.json), тома чужих проектов (nightshift, nsqa, odr…). На сервере — только кэш
// сборки и образы без имени: контейнеры, тома и образы CRM kppdf и откатный datacore-backend:prev не трогает.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--clean');
const SERVER = process.argv.includes('--server');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const say = (s) => console.log(s);

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return r.stdout.trim();
}
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const reclaim = (df) => lines(df).map((l) => l.split('\t')).filter(([t]) => t).map(([t, s, r]) => `${t}: ${s}, можно освободить ${r}`);

function server() {
  // одно подключение на запуск (несколько подряд рвёт туннель); ssh из bash (Git) — там настроен вход datacore-vm
  const DF = "docker system df --format '{{.Type}}	{{.Size}}	{{.Reclaimable}}'";
  const script = [`echo '#before'; ${DF}`, "echo '#disk'; df -h / | tail -1 | awk '{print $3\" из \"$2\" (\"$5\")\"}'",
    ...(APPLY ? ['docker builder prune -af >/dev/null && docker image prune -f >/dev/null', `echo '#after'; ${DF}`] : [])].join('; ');
  const out = sh('bash', ['-c', 'ssh -o BatchMode=yes -o ConnectTimeout=20 datacore-vm "$1"', '_', script]);
  const part = (k) => (out.split('#' + k)[1] || '').split('#')[0];
  say('Сервер — сейчас:'); reclaim(part('before')).forEach((l) => say('  ' + l));
  say('  диск занят: ' + part('disk').trim());
  if (!APPLY) { say('План: удалить кэш сборки и образы без имени. Сайт, базы, CRM и откатный образ не трогаются.'); return; }
  say('Готово. Сервер — после:'); reclaim(part('after')).forEach((l) => say('  ' + l));
}

function local() {
  const cur = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/.night/current-stand.json'), 'utf8')).project; } catch { return null; } })();
  const rows = lines(sh('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.State}}'])).map((l) => l.split('\t'));
  const vols = lines(sh('docker', ['volume', 'ls', '--format', '{{.Name}}']));
  const imgs = lines(sh('docker', ['images', '--format', '{{.Repository}}']));
  const nets = lines(sh('docker', ['network', 'ls', '--format', '{{.Name}}']));
  const stand = /^dc-([0-9a-f]{24})-night$/;
  const projects = new Set([...rows.map((r) => r[1]), ...vols.map((v) => v.split('_')[0]), ...imgs.map((i) => i.replace(/-backend$/, '')), ...nets.map((n) => n.split('_')[0])].filter((p) => stand.test(p || '')));
  const stale = [...projects].filter((p) => p !== cur).sort();
  const running = stale.filter((p) => rows.some((r) => r[1] === p && r[2] === 'running'));
  const foreign = vols.filter((v) => !/^[0-9a-f]{64}$/.test(v) && !stand.test(v.split('_')[0]) && !v.startsWith('data-core_'));
  say(`Этот ПК: старых стендов ${stale.length} (из них работают ${running.length}); оставляю текущий стенд ${cur || '—'} и локальный сайт.`);
  reclaim(sh('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'])).forEach((l) => say('  ' + l));
  if (foreign.length) say(`  чужие тома (не трогаю): ${foreign.join(', ')}`);
  if (!APPLY) { say('План: удалить старые стенды (контейнеры, тома, сети, образы, папки), кэш сборки, образы и тома без имени.'); return; }
  let left = 0;
  for (const p of stale) {
    const ids = lines(sh('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${p}`]));
    if (ids.length) sh('docker', ['rm', '-f', ...ids]);
    const pv = vols.filter((v) => v.startsWith(p + '_'));
    if (pv.length) sh('docker', ['volume', 'rm', ...pv]);
    if (imgs.includes(p + '-backend')) sh('docker', ['rmi', p + '-backend:latest']);
    // сети старого стенда: без этого они копятся, и Docker пишет «all predefined address pools have been fully subnetted» (2026-11-10)
    const pn = nets.filter((n) => n.startsWith(p + '_'));
    if (pn.length) sh('docker', ['network', 'rm', ...pn]);
    const dir = path.join(ROOT, 'tools/.night/stands', p.match(stand)[1]);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { left++; } // папку держит Windows (профиль браузера) — не беда, Docker уже чист
  }
  sh('docker', ['builder', 'prune', '-af']);
  sh('docker', ['image', 'prune', '-f']);
  sh('docker', ['volume', 'prune', '-f']); // только безымянные тома без контейнера; данные сайта — в .data/, тома с именем не затрагиваются
  say(`Готово: удалено стендов ${stale.length}${left ? `; папок не удалось убрать: ${left} (заняты Windows)` : ''}. После:`);
  reclaim(sh('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'])).forEach((l) => say('  ' + l));
}

try { SERVER ? server() : local(); } catch (e) { say('Сбой: ' + e.message); process.exit(2); }
