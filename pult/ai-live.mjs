// Пульт: «Локальный ИИ сейчас» (владелец 15.11) — что загружено и запущено, вживую; «Остановить всё» разом.
// Бывало: несколько тестовых браузеров и запусков одновременно, один остановили — остальные висят. Здесь видно всё и снимается всё.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawnSync } from 'child_process';

const LMS = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const run = (cmd, args, ms = 8000) => new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: ms, encoding: 'utf8' }, (e, out) => ok(e ? '' : String(out || ''))));
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Тестовые браузеры (без окна, с отладочным портом): ИИ-тестировщик, обходы, сценарии. Свой Edge/Chrome владельца не трогаем. */
async function testBrowsers() {
  if (process.platform !== 'win32') {
    const out = await run('pgrep', ['-af', 'remote-debugging-port']);
    return out.split('\n').filter((l) => /--headless/.test(l)).map((l) => ({ pid: Number(l.split(' ')[0]) }));
  }
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*--headless*' -and $_.CommandLine -like '*--remote-debugging-port=*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }";
  const out = await run('powershell', ['-NoProfile', '-Command', ps], 15000);
  return out.split(/\r?\n/).map((x) => Number(x.trim())).filter(Boolean).map((pid) => ({ pid }));
}

/** Состояние для пульта: модели LM Studio, тестировщик, Старожил, тестовые браузеры. */
export async function aiLive(root) {
  let models = [];
  try { models = JSON.parse((await run(LMS, ['ps', '--json'])) || '[]').map((m) => ({ id: m.identifier || m.modelKey || m.path, status: m.status || '', sizeGb: m.sizeBytes ? +(m.sizeBytes / 1e9).toFixed(1) : null })); } catch { /* LM Studio нет */ }
  const t = readJson(path.join(root, 'tools', 'logs', 'ai-tester', 'run.json'));
  const z = readJson(path.join(root, 'tools', 'logs', 'starozhil', 'run.json'));
  const browsers = await testBrowsers();
  return {
    models,
    tester: t && alive(t.pid) ? { until: t.until, model: t.model || '' } : null,
    starozhil: z && alive(z.pid) ? { job: z.job || '' } : null,
    browsers: browsers.length,
  };
}

/** «Остановить всё»: тестировщик и Старожил — штатно (допишут отчёт), затем браузеры и модели. */
export async function aiStopAll(root) {
  const node = process.execPath; const done = [];
  for (const [name, file] of [['ИИ-тестировщик', 'tools/ai-tester/run.mjs'], ['Старожил', 'tools/starozhil/run.mjs']]) {
    const r = spawnSync(node, [path.join(root, file), '--stop'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 200000 });
    done.push(`${name}: ${String(r.stdout || '').trim().split('\n').pop() || 'не работал'}`);
  }
  const br = await testBrowsers();
  for (const b of br) { try { process.kill(b.pid); } catch { /* уже закрыт */ } }
  done.push(`Тестовых браузеров закрыто: ${br.length}`);
  await run(LMS, ['unload', '--all'], 30000);
  done.push('Модели LM Studio выгружены');
  return done;
}
