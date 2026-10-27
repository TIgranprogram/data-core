import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Защита «Рабочего места» (TASKS НВ.1): импорт с именем глобального объекта браузера перекрывает его в модуле —
 * так `import { history }` (раздел «История») сломал кнопки ‹ › (`history.back is not a function`).
 */
const ROOT = join(__dirname, '..', 'pwa');
const GLOBALS = ['history', 'location', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'fetch', 'console'];
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });

describe('pwa: импорты не перекрывают глобальные объекты браузера', () => {
  it.each(files(ROOT).map((f) => [f.slice(ROOT.length + 1), f]))('%s', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    const bad: string[] = [];
    for (const m of src.matchAll(/^\s*import\s*\{([^}]*)\}\s*from/gm)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop()!.trim();
        if (GLOBALS.includes(local)) bad.push(local);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** Скорость С5: в index.html — modulepreload всех модулей, достижимых из main.js (иначе после выкладки — загрузка «лесенкой»). */
describe('pwa: список modulepreload в index.html свежий', () => {
  it('совпадает с модулями из main.js — иначе запустить node backend/scripts/pwa-preload.mjs', () => {
    const IMPORT = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) walk(join(file, '..', m[1]));
    };
    walk(join(ROOT, 'main.js'));
    const want = [...seen].map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/')).filter((f) => f !== 'main.js').sort();
    const have = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(have).toEqual(want);
  });
});

/** Нативные append/replaceChildren печатают null/false текстом («nullnull»): core/dom.js обязан их оборачивать (регэксп по вызовам даёт ложные срабатывания). */
describe('pwa: core/dom.js оборачивает нативные append/replaceChildren', () => {
  it('обёртка на месте', () => {
    const src = readFileSync(join(ROOT, 'core', 'dom.js'), 'utf8');
    for (const n of ['append', 'prepend', 'replaceChildren', 'before', 'after']) expect(src).toContain(`'${n}'`);
    expect(src).toContain('__clean');
  });
});
