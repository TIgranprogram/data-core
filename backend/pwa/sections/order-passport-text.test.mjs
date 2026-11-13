import test from 'node:test';
import assert from 'node:assert/strict';
import { missingName, shortMissing, summaryText } from './order-passport-text.js';

test('missingName: служебная фраза → название', () => {
  assert.equal(missingName('Обязательный рисунок не читается: Фото изделия. Загрузите изображение заново'), 'Фото изделия');
  assert.equal(missingName('Рисунок: Чертёж с размерами'), 'Чертёж с размерами');
  assert.equal(missingName('Габариты'), 'Габариты');
});

test('shortMissing: названия через запятую, без дублей и служебных слов', () => {
  const m = [
    'Обязательный рисунок не читается: Фото изделия. Загрузите изображение заново',
    'Обязательный рисунок не читается: Чертёж с размерами. Загрузите изображение заново',
    'Фото изделия', 'Габариты', 'Вес',
  ];
  assert.equal(shortMissing(m), 'Фото изделия, чертёж с размерами, габариты, вес');
});

test('shortMissing: «и ещё N» от сервера и лишнее сверх max складываются', () => {
  assert.equal(shortMissing(['Габариты', 'Вес', 'и ещё 1']), 'Габариты, вес и ещё 1');
  assert.equal(shortMissing(['А', 'Б', 'В', 'Г', 'Д', 'и ещё 2']), 'А, б, в, г и ещё 3');
  assert.equal(shortMissing([]), '');
});

test('summaryText: без перечня причин', () => {
  const lines = [{ state: 'blocked' }, { state: 'blocked' }, { state: 'ready' }];
  assert.equal(summaryText({ ready: 1, issued: 0, total: 3, lines }), 'Готово 1 из 3 · заполнить: 2 позиции');
  assert.equal(summaryText({ ready: 0, issued: 5, total: 5, lines: [] }), 'Готово 5 из 5');
  assert.equal(summaryText({ total: 12, lines: Array(11).fill({ state: 'blocked' }) }), 'Готово 0 из 12 · заполнить: 11 позиций');
  assert.equal(summaryText({ total: 1, lines: [{ state: 'blocked' }] }), 'Готово 0 из 1 · заполнить: 1 позицию');
});
