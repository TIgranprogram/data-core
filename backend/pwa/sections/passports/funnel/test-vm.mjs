// Общий загрузчик модулей для тестов воронки: все импорты — заглушки, нужные — свои (C096 Э4).
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

/** Элемент-заглушка: хранит детей, атрибуты и обработчики; querySelector* ищет нужное по признаку. */
export function fakeEl(tag = 'div', props = {}) {
  const el = {
    tag, children: [], hidden: false, disabled: false, dataset: {}, style: {}, textContent: '', ...props,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; }, prepend(...xs) { this.children.unshift(...xs); },
    addEventListener() {}, removeEventListener() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [], after() {}, focus() {},
    scrollIntoView() {}, getClientRects: () => [1],
  };
  return el;
}

export async function load(url, own = {}) {
  const src = readFileSync(url, 'utf8');
  const context = createContext({ window: { dispatchEvent() {} }, CustomEvent: class { constructor(t) { this.type = t; } }, Event: class {}, setTimeout, clearTimeout, queueMicrotask, Promise, JSON, Map, Set, Date, Error, console });
  const mod = new SourceTextModule(src, { context });
  await mod.link((key) => {
    const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].filter((m) => m[2] === key).flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const mine = own[key] || {};
    const values = Object.fromEntries(names.map((n) => [n, n in mine ? mine[n] : () => fakeEl()]));
    return new SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}
