// Отмена только известного дочернего процесса. Ошибка taskkill не считается успешной остановкой.
import { execFile } from 'node:child_process';
export async function terminateProcess(pid, { platform = process.platform, execFileFn = execFile, killFn = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'Нет PID дочернего процесса' };
  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFileFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (error, stdout, stderr) => {
        resolve(error ? { ok: false, error: String(stderr || error.message).trim() } : { ok: true });
      });
    });
  }
  try { killFn(pid, 'SIGTERM'); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message }; }
}
