// Скорость С5 (2026-10-22): список модулей «Рабочего места» для <link rel="modulepreload"> в pwa/index.html.
// Список — только то, что main.js грузит статически (ядро, ui, «Сегодня»); разделы подгружаются import() при первом открытии (main.js LAZY).
// Без него браузер после выкладки качает модули «лесенкой» (main → разделы → ui → core: 4–5 шагов по ~1 с через туннель),
// с ним — все сразу, параллельно. Так при первом заходе тянется ~40 файлов вместо ~130.
// Запуск после добавления/удаления модуля:  node backend/scripts/pwa-preload.mjs   (тест pwa-guards проверяет, что список свежий)
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const PWA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pwa');
const IMPORT = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

export function preloadList(root = PWA) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) walk(resolve(dirname(file), m[1]));
  };
  walk(join(root, 'main.js'));
  return [...seen].map((f) => relative(root, f).split('\\').join('/')).filter((f) => f !== 'main.js').sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = join(PWA, 'index.html');
  const html = readFileSync(file, 'utf8');
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  const block = ['  <!-- preload:begin (node backend/scripts/pwa-preload.mjs) -->', ...preloadList().map((f) => `  <link rel="modulepreload" href="${f}" />`), '  <!-- preload:end -->'].join(nl);
  const next = /  <!-- preload:begin[\s\S]*?<!-- preload:end -->/.test(html)
    ? html.replace(/  <!-- preload:begin[\s\S]*?<!-- preload:end -->/, block)
    : html.replace('  <script type="module" src="main.js"></script>', `  <script type="module" src="main.js"></script>${nl}${block}`);
  writeFileSync(file, next);
  console.log(`modulepreload: ${preloadList().length} модулей → pwa/index.html`);
}
