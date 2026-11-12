import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { readyFileNumber, readyFileDirty, clearProductSelection } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('./form-state.js', import.meta.url), 'utf8')).toString('base64'));

test('предложенный и заменённый номера всегда передаются явно', () => {
  assert.equal(readyFileNumber({ number: '123', suggested: '123' }), '123');
  assert.equal(readyFileNumber({ number: '50', suggested: '123' }), '50');
  assert.throws(() => readyFileNumber({ number: '' }));
});
test('файл держит предупреждение до успешного сохранения', () => {
  assert.equal(readyFileDirty({ file: {} }, false), true);
  assert.equal(readyFileDirty({ file: {} }, true), false);
  assert.equal(readyFileDirty({ file: null }, false), false);
});
test('смена изделия сбрасывает прежнюю связь и сохраняет ручные данные', () => {
  const data = { productId: 'old', name: 'Ручное название', certNumber: 'Сертификат' };
  clearProductSelection({ set: (key, value) => { data[key] = value; } });
  assert.deepEqual(data, { productId: '', name: 'Ручное название', certNumber: 'Сертификат' });
});

test('смена изделия очищает автоматические поля и картинки, сохраняя ручное и данные экземпляра', () => {
  const data = { productId: 'old', name: 'Старое', length: 50, certNumber: 'Сертификат', _copyFrom: 'passport', img_overview: '["photo"]', note: 'Заметка' };
  const autos = ['name', 'length', 'img_overview'];
  clearProductSelection({ keys: () => Object.keys(data), input: (k) => ({ el: { classList: { contains: () => autos.includes(k) } } }), manual: (k) => k === 'length', set: (k, v) => { data[k] = v; } });
  assert.deepEqual(data, { productId: '', name: '', length: 50, certNumber: 'Сертификат', _copyFrom: '', img_overview: '', note: 'Заметка' });
});
