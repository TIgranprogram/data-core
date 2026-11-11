import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePng } from './compare.mjs';

const frame = (size, dark = false) => {
  const p = new PNG({ width: size, height: size });
  p.data.fill(dark ? 0 : 255);
  for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
  return PNG.sync.write(p);
};
test('одинаковая картинка не вызывает визуальную проверку', () => {
  assert.equal(comparePng(frame(20), frame(20)).status, 'same');
});
test('изменение картинки возвращает карту различий', () => {
  const r = comparePng(frame(20), frame(20, true));
  assert.equal(r.status, 'changed'); assert.equal(r.pixels, 400); assert.ok(r.diff.length);
});
test('изменение размера не теряется и не становится успехом', () => {
  assert.equal(comparePng(frame(20), frame(21)).status, 'size_changed');
});
