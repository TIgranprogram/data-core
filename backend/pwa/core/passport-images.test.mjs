// Картинки паспорта по видам (ФП): node --test backend/pwa/core/passport-images.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { formImages, imagesBody, modelImagesToForm } from './passport-images.js';

const KINDS = ['overview', 'dimensions', 'safety', 'mounting', 'foundation'];

test('каждая картинка — только в своём виде, порядок внутри вида', () => {
  const body = formImages({ img_overview: ['a', 'b'], img_dimensions: ['c'], img_safety: [] }, KINDS);
  assert.deepEqual(body, [
    { kind: 'overview', photoId: 'a', order: 0 }, { kind: 'overview', photoId: 'b', order: 1 }, { kind: 'dimensions', photoId: 'c', order: 0 }]);
});

test('один снимок дважды в виде — один раз; в разных видах — можно', () => {
  const body = formImages({ img_overview: ['a', 'a'], img_mounting: ['a'] }, KINDS);
  assert.equal(body.filter((i) => i.kind === 'overview').length, 1);
  assert.equal(body.filter((i) => i.kind === 'mounting').length, 1);
});

test('без вида — только «Общий вид»', () => {
  assert.deepEqual(imagesBody([{ photoId: 'x' }, { kind: 'dimensions', photoId: 'y' }]),
    [{ kind: 'overview', photoId: 'x', order: 0 }, { kind: 'dimensions', photoId: 'y', order: 0 }]);
});

test('картинки модели раскладываются по видам: safety_zone → safety, без вида → overview, без файла — пропуск', () => {
  const by = modelImagesToForm([
    { kind: 'dimensions', photoId: '2', url: '/u/2.png', order: 1 }, { kind: 'dimensions', photoId: '1', url: '/u/1.png', order: 0 },
    { kind: 'safety_zone', photoId: '3', url: '/u/3.png' }, { photoId: '4', url: '/u/4.png' }, { kind: 'mounting', photoId: '5', url: null }], KINDS);
  assert.deepEqual(by.dimensions.map((p) => p.id), ['1', '2']);
  assert.deepEqual(by.safety.map((p) => p.id), ['3']);
  assert.deepEqual(by.overview.map((p) => p.id), ['4']);
  assert.deepEqual(by.mounting, []);
  assert.deepEqual(by.foundation, []);
});

test('модель → форма → тело запроса: без дублей и без переноса в другие виды', () => {
  const by = modelImagesToForm([{ kind: 'overview', photoId: 'o', url: '/o' }, { kind: 'foundation', photoId: 'f', url: '/f' }], KINDS);
  const values = Object.fromEntries(Object.entries(by).map(([k, l]) => ['img_' + k, l.map((p) => p.id)]));
  values.img_overview.push('new'); // своя вставка в «Общий вид»
  assert.deepEqual(formImages(values, KINDS).map((i) => `${i.kind}:${i.photoId}`), ['overview:o', 'overview:new', 'foundation:f']);
});
