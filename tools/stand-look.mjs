#!/usr/bin/env node
// Вход на стенд для Claude одной командой (C114, 2026-11-14): чтобы не наступать каждый раз на одни и те же грабли.
// Грабли, которые этот скрипт закрывает:
//   1) вход: POST /api/auth/login принимает только { username, password } (не login/email) — иначе 400;
//   2) адрес приложения на стенде — http://localhost:3102/app/ (без /db, /db только на проде через nginx);
//   3) старый код из кэша приложения (service worker) — перед просмотром его надо сбросить;
//   4) пароль не печатается: учётка из tools/logs/stand-login.local.env (её создаёт dc audit).
// Запуск:  node tools/stand-look.mjs [hash]        например: node tools/stand-look.mjs "products?q=3201"
//          node tools/stand-look.mjs --refresh ...  сначала пересобрать стенд из текущего кода (~2 мин)
//          node tools/stand-look.mjs --refresh --src ../data-core-c115 ...  код из другой копии (worktree): запускать ИЗ ЭТОЙ папки —
//            паспорт стенда лежит здесь (tools/logs), из копии защита стенда откажет (C115, 14.11)
// Итог: tools/logs/stand-look.js — вставить целиком в javascript_tool встроенного браузера на любой странице стенда:
//   он кладёт вход в localStorage, сбрасывает кэш приложения и открывает нужный экран.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:3102';
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const srcAt = args.indexOf('--src');
const src = srcAt >= 0 ? path.resolve(args[srcAt + 1] || '') : null;
if (srcAt >= 0 && !fs.existsSync(path.join(src || '', 'backend'))) { console.error('--src: нет папки backend в ' + src); process.exit(2); }
const hash = (args.find((a, i) => !a.startsWith('--') && (srcAt < 0 || i !== srcAt + 1)) || 'home').replace(/^#/, '');

if (refresh) {
  const { standRefresh } = await import('./night.mjs');
  await standRefresh({ say() {}, log() {} }, ...(src ? [src] : []));
}

const envFile = path.join(ROOT, 'tools/logs/stand-login.local.env');
if (!fs.existsSync(envFile)) { console.error('Нет tools/logs/stand-login.local.env — запустите dc audit один раз.'); process.exit(2); }
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

let j;
try {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: env.STAND_LOGIN, password: env.STAND_PASSWORD }) });
  j = await r.json();
  if (!r.ok || !j.access) { console.error('Вход не удался:', r.status, j?.message || ''); process.exit(1); }
} catch (e) { console.error('Стенд не отвечает на', BASE, '—', e.message); process.exit(2); }

const js = [
  `localStorage.setItem('dca_access', ${JSON.stringify(j.access)});`,
  `localStorage.setItem('dca_refresh', ${JSON.stringify(j.refresh)});`,
  `localStorage.setItem('dca_user', ${JSON.stringify(JSON.stringify(j.user))});`,
  `for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();`,
  `for (const k of await caches.keys()) await caches.delete(k);`,
  `location.href = ${JSON.stringify(`${BASE}/app/?r=${Date.now()}#${hash}`)};`,
  `'вход: ${j.user?.username} (${j.user?.role})'`,
].join('\n');
const out = path.join(ROOT, 'tools/logs/stand-look.js');
fs.writeFileSync(out, js);
console.log(`Готово: ${path.relative(ROOT, out)} → вставить в javascript_tool на странице ${BASE}/app/ (роль ${j.user?.role}; витрина #kit — только admin).`);
