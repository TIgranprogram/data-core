// Отмена только известного дочернего процесса. Ошибка taskkill не считается успешной остановкой.
// «Процесс не найден» — уже остановлен (гонка с естественным выходом) → успех.
import { execFile } from 'node:child_process';

const GONE = /not found|не удается найти|не удаётся найти|не найден|no running instance/i;

/** stderr taskkill на русской Windows — OEM (cp866), не UTF-8. */
function winText(buf) {
  if (buf == null) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  if (!b.length) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* OEM */ }
  try { return new TextDecoder('ibm866').decode(b); } catch { return b.toString('latin1'); }
}

export async function terminateProcess(pid, { platform = process.platform, execFileFn = execFile, killFn = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'Нет PID дочернего процесса' };
  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFileFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, encoding: 'buffer' }, (error, stdout, stderr) => {
        const msg = winText(stderr) || winText(stdout) || (error && error.message) || '';
        if (!error) return resolve({ ok: true });
        // 128 — процесс уже нет; иначе гонка «закрылся сам / stop»
        const status = error.status ?? error.code;
        if (status === 128 || GONE.test(msg)) return resolve({ ok: true });
        resolve({ ok: false, error: msg.trim() || String(error.message) });
      });
    });
  }
  try { killFn(pid, 'SIGTERM'); return { ok: true }; }
  catch (error) {
    if (error && (error.code === 'ESRCH' || GONE.test(error.message || ''))) return { ok: true };
    return { ok: false, error: error.message };
  }
}
