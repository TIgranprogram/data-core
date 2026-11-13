import test from 'node:test';
import assert from 'node:assert/strict';
import { barText } from './bar.js';

test('есть пробелы: «Осталось N: первый и ещё …», выпуск неактивен с причиной', () => {
  const t = barText([{ label: 'Вес' }, { label: 'Рост' }], { ready: false, why: 'Сначала заполните недостающее', need: [{ label: 'фирма' }] });
  assert.equal(t.ready, false); assert.equal(t.left, 'Осталось 3: Вес и ещё 2 →'); assert.equal(t.title, 'Сначала: Вес и ещё 2');
});
test('один пробел — без «и ещё»', () => {
  assert.equal(barText([], { ready: false, why: 'Выберите фирму', need: [{ label: 'фирма' }] }).left, 'Осталось 1: фирма →');
});
test('всё готово: кнопка активна, слова вместо ссылки', () => {
  const t = barText([], { ready: true, why: 'Присвоить номер', need: [] });
  assert.equal(t.ready, true); assert.equal(t.left, ''); assert.match(t.ok, /можно выпускать/);
});
test('фирмы ещё грузятся: неактивна, причина словами', () => {
  const t = barText([], { ready: false, why: 'Загружаю фирмы…', need: [] });
  assert.equal(t.ready, false); assert.equal(t.ok, 'Загружаю фирмы…');
});
