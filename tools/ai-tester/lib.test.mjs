// node --test tools/ai-tester/lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAG, isLocalStand, tagText, createdFrom, groupFindings, screenGarbage, blockedClick, buildReport, screenChange } from './lib.mjs';

test('работает только на стенде этого ПК', () => {
  assert.equal(isLocalStand('http://localhost:3102'), true);
  assert.equal(isLocalStand('http://127.0.0.1:3102'), true);
  assert.equal(isLocalStand('https://kppdf-crm.ru/db'), false);
  assert.equal(isLocalStand('http://localhost:3001'), false); // локальный сайт с настоящей базой
  assert.equal(isLocalStand('http://localhost:3000'), false);
});

test('метка ТЕСТ-ИИ: в названиях есть, в поиске и числах нет', () => {
  assert.equal(tagText('Поставщик Ромашка'), `${TAG} Поставщик Ромашка`);
  assert.equal(tagText(`${TAG} уже`), `${TAG} уже`);
  assert.equal(tagText('труба', { search: true }), 'труба');
  assert.equal(tagText('Ромашка', { combo: true }), 'Ромашка');
  assert.equal(tagText('1500'), '1500');
  assert.equal(tagText('2026-11-10', { type: 'date' }), '2026-11-10');
  assert.equal(tagText('7701234567'), '7701234567');
});

test('созданная запись — только создание в корне коллекции', () => {
  const id = '65a1b2c3d4e5f6a7b8c9d0e1';
  assert.deepEqual(createdFrom('POST', 'http://x/api/partners', 201, { id }), { path: '/partners', id });
  assert.deepEqual(createdFrom('POST', 'http://x/api/supply/requests', 200, JSON.stringify({ id })), { path: '/supply/requests', id });
  assert.equal(createdFrom('POST', `http://x/api/supplyrequests/${id}/items`, 200, { id }), null); // чужая заявка
  assert.equal(createdFrom('POST', 'http://x/api/passports/check', 200, { id }), null);
  assert.equal(createdFrom('POST', 'http://x/api/auth/login', 200, { id }), null);
  assert.equal(createdFrom('PUT', 'http://x/api/partners', 200, { id }), null);
  assert.equal(createdFrom('POST', 'http://x/api/partners', 400, { id }), null);
});

test('одинаковые находки склеиваются', () => {
  const g = groupFindings([
    { kind: 'ошибка', text: 'сервер ответил ошибкой 500 на POST /partners', task: 'a' },
    { kind: 'ошибка', text: 'сервер ответил ошибкой 502 на POST /partners', task: 'b' },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 2);
  assert.deepEqual(g[0].tasks, ['a', 'b']);
});

test('мусор на экране', () => {
  assert.equal(screenGarbage('Сумма: undefined ₽'), 'undefined');
  assert.equal(screenGarbage('[object Object]'), '[object Object]');
  assert.equal(screenGarbage('Итого 1 500 ₽'), '');
});

test('нельзя выйти и удалить чужое', () => {
  assert.match(blockedClick('Выйти'), /нельзя/);
  assert.match(blockedClick('Удалить', 'Поставщик Ромашка'), /только свои/);
  assert.equal(blockedClick('Удалить', `${TAG} Поставщик`), '');
  assert.equal(blockedClick('Сохранить'), '');
});

test('отчёт собирается', () => {
  const md = buildReport({ day: '2026-11-10', model: 'm', startedAt: 0, now: 3600000, tasks: [{ at: '10:00', title: 'Контрагенты: partner', result: 'получилось', steps: 5, summary: 'ок' }], findings: [{ kind: 'ошибка', text: 'x', task: 't' }, { kind: 'ИИ: неудобно', text: 'y', task: 't' }], created: [{}], removed: 1 });
  assert.match(md, /Заданий: 1 \(получилось 1/);
  assert.match(md, /Ошибок сайта: 1, замечаний ИИ: 1/);
  assert.match(md, /убрано: 1/);
});

test('после действия модель узнаёт, изменился ли экран (иначе жмёт ту же строку по кругу)', () => {
  const a = { hash: '#salesorders', layer: '', text: 'список', els: ['[1] строка «Заказ 24»'] };
  assert.match(screenChange(a, { ...a }), /не изменился/);
  assert.match(screenChange(a, { ...a, layer: 'Заказ № 24' }), /Открылась панель «Заказ № 24»/);
  assert.match(screenChange({ ...a, layer: 'Заказ № 24' }, a), /закрылась/);
  assert.match(screenChange(a, { ...a, hash: '#money' }), /другой экран/);
  assert.match(screenChange(a, { ...a, text: 'список 2' }), /обновился/);
});
