// Сравнение с явно выбранным эталоном. Эталон никогда не обновляется автоматически.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export function comparePng(before, after) {
  const a = PNG.sync.read(before), b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return { status: 'size_changed', before: [a.width, a.height], after: [b.width, b.height] };
  const diff = new PNG({ width: a.width, height: a.height });
  const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false });
  return { status: pixels ? 'changed' : 'same', pixels, ratio: pixels / (a.width * a.height), diff: pixels ? PNG.sync.write(diff) : null };
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 4 || args[0] !== '--baseline' || args[2] !== '--current') {
    console.log('Нужны --baseline <эталон.png> --current <снимок.png>. Изменение снимка — повод для проверки, не доказательство дефекта.'); return 2;
  }
  try {
    for (const file of [args[1], args[3]]) {
      if (path.extname(file).toLowerCase() !== '.png' || fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('PNG до 8 МБ');
      const head = fs.readFileSync(file).subarray(0, 24);
      if (head.length < 24 || head.readUInt32BE(16) * head.readUInt32BE(20) > 20000000) throw new Error('Слишком большое изображение');
    }
    const { diff, ...result } = comparePng(fs.readFileSync(args[1]), fs.readFileSync(args[3]));
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../logs/design-diff', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ ...result, baseline: path.resolve(args[1]), current: path.resolve(args[3]) }, null, 2));
    if (diff) fs.writeFileSync(path.join(dir, 'diff.png'), diff);
    console.log(`Сравнение: ${result.status}; изменённых пикселей: ${result.pixels ?? 'размер изменён'}.\nОтчёт: ${dir}`);
    return result.status === 'same' ? 0 : 1;
  } catch (e) { console.error('Сравнение не выполнено: ' + e.message); return 2; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
