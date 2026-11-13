// Локальный ИИ (LM Studio) — одна копия для всех исполнителей: ИИ-тестировщик, наряды Старожила.
// Настройки — tools/ai-tester/settings.json (ставит «Установить ИИ на этом ПК»), в git не идёт.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadSettings() {
  const f = path.join(HERE, 'settings.json');
  if (!fs.existsSync(f)) fs.copyFileSync(path.join(HERE, 'settings.example.json'), f);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { stepsPerTask: 20, temperature: 0.3, apiKey: 'lm-studio', stand: 'http://localhost:3102', ...s, baseUrl: String(s.baseUrl || '').replace(/\/+$/, ''), stand: String(s.stand || 'http://localhost:3102').replace(/\/+$/, '') };
}

export async function llm(s, body, ms = 240000) {
  const r = await fetch(`${s.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, temperature: s.temperature, ...body }), signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ИИ ответил ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * LM Studio закрыт или модель не загружена — запустить сервер и загрузить модель консольной командой lms
 * (ставится вместе с LM Studio). Память модели — 16 тыс. токенов: по умолчанию её меньше, и длинный экран не влезает.
 */
export const LMS = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
export async function llmUp(s) { try { return (await (await fetch(`${s.baseUrl}/models`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(6000) })).json())?.data || null; } catch { return null; } }
export async function modelLoaded(s) {
  try { const j = await (await fetch(s.baseUrl.replace(/\/v1$/, '') + '/api/v0/models', { signal: AbortSignal.timeout(6000) })).json(); return j.data?.find((m) => m.id === s.model)?.state === 'loaded'; } catch { return false; }
}
export async function ensureLLM(s, log = console.log) {
  let local = false; let port = '1234';
  try { const u = new URL(s.baseUrl); local = ['localhost', '127.0.0.1'].includes(u.hostname); port = u.port || '1234'; } catch { /* адрес кривой */ }
  if (!(await llmUp(s))) {
    if (!local || !fs.existsSync(LMS)) return false;
    log('   LM Studio не отвечает — запускаю его сервер…');
    spawnSync(LMS, ['server', 'start', '--port', port], { encoding: 'utf8', timeout: 90000, windowsHide: true });
    for (let i = 0; i < 20 && !(await llmUp(s)); i++) await sleep(1500);
    if (!(await llmUp(s))) return false;
  }
  if (local && fs.existsSync(LMS) && !(await modelLoaded(s))) {
    log(`   Загружаю модель ${s.model} (до 1 минуты)…`);
    spawnSync(LMS, ['unload', '--all'], { encoding: 'utf8', timeout: 60000, windowsHide: true }); // две модели в 16 ГБ не влезут
    spawnSync(LMS, ['load', s.model, '--context-length', '16384', '--gpu', 'max', '-y'], { encoding: 'utf8', timeout: 180000, windowsHide: true });
  }
  return true;
}

/** Не давать Windows уснуть, пока идёт этот процесс (SetThreadExecutionState; настройки питания не меняются). */
export function keepAwake() {
  if (process.platform !== 'win32') return null;
  const ps = `$k=Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name K -Namespace W -PassThru;` +
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { [void]$k::SetThreadExecutionState(0x80000001); Start-Sleep 30 }`;
  return spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}
