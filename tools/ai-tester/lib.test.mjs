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

// ---------- C088: изоляция, запуски, классы находок, уборка ----------
import { isLocalModel, standMatchesPassport, newRunId, netFinding, cleanupAllowed } from './lib.mjs';

test('модель — только LM Studio этого ПК', () => {
  assert.equal(isLocalModel('http://localhost:1235/v1'), true);
  assert.equal(isLocalModel('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalModel('https://api.openai.com/v1'), false);
  assert.equal(isLocalModel('http://192.168.1.5:1234/v1'), false);
  assert.equal(isLocalModel('http://localhost.evil.com:1234/v1'), false);
  assert.equal(isLocalModel('http://user:pw@localhost:1234/v1'), false);
  assert.equal(isLocalModel(''), false);
});

test('стенд — только адрес из паспорта собственного стенда', () => {
  const run = { apiPort: 3112 };
  assert.equal(standMatchesPassport('http://localhost:3112', run), true);
  assert.equal(standMatchesPassport('http://localhost:3102', run), false); // соседний стенд
  assert.equal(standMatchesPassport('http://localhost:3001', { apiPort: 3001 }), false); // рабочий сайт
  assert.equal(standMatchesPassport('https://kppdf-crm.ru/db', run), false);
  assert.equal(standMatchesPassport('http://localhost:3112', null), false);
});

test('ID запуска уникален и читаем', () => {
  const d = new Date(2026, 10, 12, 18, 5, 9);
  assert.equal(newRunId(d, () => 0), '20261112-180509-000000');
  assert.notEqual(newRunId(d), newRunId(d));
  assert.match(newRunId(), /^\d{8}-\d{6}-[0-9a-f]{6}$/);
});

test('5xx — ошибка сайта; 4xx — отказ (не дефект); 401/409 — норма', () => {
  assert.deepEqual(netFinding({ method: 'POST', url: '/x?a=1', status: 500, ms: 10 }).map((f) => f.kind), ['ошибка']);
  assert.deepEqual(netFinding({ method: 'PATCH', url: '/x', status: 400, ms: 10, msg: 'bad' }).map((f) => f.kind), ['отказ']);
  assert.deepEqual(netFinding({ method: 'GET', url: '/x', status: 404, ms: 10 }).map((f) => f.kind), ['отказ']);
  assert.deepEqual(netFinding({ method: 'POST', url: '/x', status: 401, ms: 10 }), []);
  assert.deepEqual(netFinding({ method: 'POST', url: '/x', status: 409, ms: 10 }), []);
  assert.deepEqual(netFinding({ method: 'GET', url: '/x', status: 200, ms: 4000 }).map((f) => f.kind), ['медленно']);
});

test('уборка: только с меткой или созданное тестировщиком в этом запуске', () => {
  assert.equal(cleanupAllowed({ name: `${TAG} Ромашка` }), true);
  assert.equal(cleanupAllowed({ name: 'Ромашка' }), false); // чужая запись без метки
  const since = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(cleanupAllowed({ createdBy: 'u1', createdAt: '2026-11-12T10:05:00Z' }, { userId: 'u1', since }), true);
  assert.equal(cleanupAllowed({ createdBy: 'u1', createdAt: '2026-11-12T09:00:00Z' }, { userId: 'u1', since }), false); // старая
  assert.equal(cleanupAllowed({ createdBy: 'u2', createdAt: '2026-11-12T10:05:00Z' }, { userId: 'u1', since }), false); // другой автор
  assert.equal(cleanupAllowed(null), false);
});

test('отчёт разделяет ошибки, отказы, гипотезы и сбои тестировщика; пишет запуск', () => {
  const md = buildReport({ day: 'd', model: 'm', startedAt: 0, now: 60000, tasks: [], created: [], removed: 0, role: 'manager',
    run: { id: '20261112-180509-000000', commit: 'abc', stand: 'http://localhost:3112', baseUrl: 'http://localhost:1235/v1', stepsPerTask: 20, status: 'срок вышел', plannedMin: 20 },
    findings: [{ kind: 'отказ', text: 'сайт отказал', task: 't' }, { kind: 'ИИ: ошибка', text: 'гипотеза', task: 't' }],
    faults: [{ at: '10:00', text: 'ИИ не ответил' }], left: [{ path: '/partners', id: '1', reason: 'нет метки' }] });
  assert.match(md, /Ошибок сайта: 0, замечаний ИИ: 1/); // отказ и сбой — не ошибки сайта
  assert.match(md, /сбоев тестировщика: 1/);
  assert.match(md, /запуск 20261112-180509-000000/);
  assert.match(md, /Роль: manager \(проверен/);
  assert.match(md, /оставлено: 1/);
  assert.match(md, /## Сбои тестировщика[\s\S]*ИИ не ответил/);
  const admin = buildReport({ day: 'd', model: 'm', startedAt: 0, now: 1, tasks: [], findings: [], created: [], role: 'admin' });
  assert.match(admin, /НЕ manager/);
});
