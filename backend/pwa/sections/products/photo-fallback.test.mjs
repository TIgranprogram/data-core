import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Исполняем конфигурацию реального экрана; зависимости DOM и сети заменены наблюдаемыми адаптерами.
function fixture(canEdit = true) {
  const source = readFileSync(new URL('../products.js', import.meta.url), 'utf8');
  const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from/g)]
    .flatMap((m) => m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).at(-1)));
  const saves = [], patches = [], galleries = [];
  const context = vm.createContext({ ...Object.fromEntries(names.map((n) => [n, () => null])),
    session: { canEdit }, data: { setPhotoOrder: async (row, ids) => saves.push({ row, ids }) },
    screenCard: (cfg) => cfg, h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    stack: (...children) => children.filter(Boolean), kitButton: (cfg) => ({ button: cfg }),
    carousel: (...args) => { galleries.push(args); return { el: { gallery: args[0] } }; },
    patch: (value) => patches.push(value),
  });
  const script = source.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*;\r?\n/gm, '')
    .replace('export const products =', 'globalThis.products =');
  vm.runInContext(script, context);
  return { card: context.products.card, saves, patches, galleries };
}

const fallback = () => ({ id: 'product', photos: [], photo: { id: 'overview', url: '/uploads/overview.png' }, photoSource: 'passport' });

test('общий вид виден крупно только для чтения; показ не сохраняет его и не даёт убрать или переставить', async () => {
  const f = fixture();
  const row = fallback();
  const body = f.card.body(row);
  assert.equal(body[0].gallery[0], row.photo);
  assert.equal(f.galleries[0].length, 1); // у carousel нет onAdd/изменяющих обработчиков
  assert.equal(f.card.gallery(row).length, 0); // общая изменяемая галерея не получает резерв
  assert.equal(f.saves.length, 0);
  assert.equal(f.patches.length, 0);
  await body.find((el) => el.button).button.onClick();
  assert.equal(f.saves[0].row, row);
  assert.deepEqual(Array.from(f.saves[0].ids), ['overview']);
  assert.equal(f.patches.length, 1);
});

test('читатель видит резерв, но не кнопку принятия; собственные фото не подменяются', () => {
  const f = fixture(false), row = fallback();
  assert.ok(f.card.body(row)[0].gallery);
  assert.equal(f.card.body(row).some((el) => el.button), false);
  const own = { ...row, photos: [{ id: 'own', url: '/uploads/own.png' }] };
  assert.equal(f.card.body(own), null);
  assert.equal(f.card.gallery(own), own.photos);
  assert.equal(f.card.body({ photos: [] }), null);
});
