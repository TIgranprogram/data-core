import test from 'node:test';
import assert from 'node:assert/strict';
import { missingName, shortMissing, summaryText } from './order-passport-text.js';

test('missingName: служебная фраза → название', () => {
  assert.equal(missingName('Обязательный рисунок не читается: Фото изделия. Загрузите изображение заново'), 'Фото изделия');
  assert.equal(missingName('Фото изделия: файл на сервере повреждён или пропал — замените фото'), 'Фото изделия');
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
  assert.equal(summaryText({ ready: 1, issued: 0, total: 3, lines }), 'Документы готовы 0 из 3 · на сайте: 0 · вложенные: 0 · к выпуску: 1 · заполнить или выбрать файл: 2 позиции');
  assert.equal(summaryText({ ready: 0, issued: 5, total: 5, lines: [] }), 'Документы готовы 5 из 5 · на сайте: 5 · вложенные: 0 · к выпуску: 0');
  assert.equal(summaryText({ ready: 1, issued: 1, attached: 1, blocked: 1, total: 4 }), 'Документы готовы 2 из 4 · на сайте: 1 · вложенные: 1 · к выпуску: 1 · заполнить или выбрать файл: 1 позицию');
});
