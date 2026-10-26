#!/usr/bin/env node
// БКП: расшифровать копию «вне дома» (.dcb) → .zip (внутри mongo-<штамп>/ и uploads-<штамп>/).
// Запуск: node backup-decrypt.js datacore-2026-10-26_031500.dcb  (пароль спросит; или переменная BACKUP_PASSWORD)
// Формат: «DCB1» + соль 16 + iv 12 + данные AES-256-GCM + тег 16 в конце; ключ = scrypt(пароль, соль, 32).
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');

async function main() {
  const src = process.argv[2];
  if (!src || !fs.existsSync(src)) { console.error('Укажите файл .dcb'); process.exit(1); }
  const password = process.env.BACKUP_PASSWORD || await new Promise((ok) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question('Пароль шифрования: ', (a) => { rl.close(); ok(a); }); });
  const size = fs.statSync(src).size;
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(32); fs.readSync(fd, head, 0, 32, 0);
  if (head.subarray(0, 4).toString() !== 'DCB1') { console.error('Это не копия data-core (нет DCB1)'); process.exit(1); }
  const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(password, head.subarray(4, 20), 32), head.subarray(20, 32));
  d.setAuthTag(tag);
  const out = src.replace(/\.dcb$/, '') + '.zip';
  await new Promise((ok, bad) => fs.createReadStream(src, { start: 32, end: size - 17 }).pipe(d).on('error', () => bad(new Error('Неверный пароль или файл повреждён'))).pipe(fs.createWriteStream(out)).on('finish', ok));
  console.log('Готово: ' + out);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
