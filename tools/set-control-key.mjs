// Сохраняет машинный ключ для отправки итога ночного прогона на сайт (раздел «Состояние»).
// Ключ берётся из буфера обмена: его копируют в админке при создании. В вывод ключ не попадает.
// Результат: tools/logs/control-key.local.env (в git не попадает).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'tools', 'logs', 'control-key.local.env');
const DEFAULT_URL = 'https://kppdf-crm.ru/db';

export function readClipboard() {
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { windowsHide: true, encoding: 'utf8' })
    : spawnSync('pbpaste', [], { windowsHide: true, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

export const isKey = (s) => /^kppd_[A-Za-z0-9_-]{8,200}$/.test(s);

export function main({ clip = readClipboard, file = FILE } = {}) {
  const key = clip();
  if (!isKey(key)) {
    console.log('✗ В буфере обмена нет ключа вида kppd_… Откройте админку → «API-ключи» → «Выдать ключ», скопируйте ключ и нажмите кнопку снова.');
    return 1;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `CONTROL_URL=${DEFAULT_URL}\nCONTROL_KEY=${key}\n`, { mode: 0o600 });
  console.log('✓ Ключ сохранён на этом ПК. Следующий ночной прогон отправит итог на сайт.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
