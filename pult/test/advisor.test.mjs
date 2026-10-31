// «Что делать сейчас»: правила на выдуманном состоянии.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { advise, LEVELS, todoDone } from '../advisor.mjs';
import { COMMANDS } from '../catalog.mjs';

const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const DAY = 86400000;
const calm = { site: true, gateFiles: [], ahead: 0, behind: 0, undeployed: 0, route: 'через VPS' };
const allFresh = Object.fromEntries(COMMANDS.filter((c) => c.every).map((c) => [c.id, { at: NOW - 1000, code: 0 }]));
const plan = (s, runs) => advise({ ...calm, ...s }, runs, COMMANDS, NOW).items;
const find = (items, cmd) => items.find((x) => x.cmd === cmd);

test('всё сделано — дел нет', () => {
  assert.deepEqual(plan({}, allFresh), []);
});

test('каждая рекомендация ведёт на настоящую кнопку и уровень', () => {
  const items = plan({ site: false, gateFiles: ['a'], behind: 1, ahead: 1, route: null }, {});
  assert.ok(items.length > 3);
  for (const x of items) {
    assert.ok(COMMANDS.some((c) => c.id === x.cmd), x.cmd);
    assert.ok(LEVELS.some((l) => l.id === x.level), x.level);
  }
});

test('сайт лежит — первым делом', () => {
  assert.equal(plan({ site: false }, allFresh)[0].level, 'urgent');
});

test('находка осмотра не уходит, пока осмотр её показывает', () => {
  const runs = { ...allFresh, 'prod-doctor': { at: NOW - 1000, code: 1, bad: ['✗ Целостность склада: проблем 1'] } };
  const x = find(plan({}, runs), 'prod-doctor');
  assert.equal(x.level, 'urgent');
  assert.match(x.why, /Целостность/);
});

test('незакоммиченный код закрывает выкладку и не советует её', () => {
  const items = plan({ gateFiles: ['backend/a.ts'], undeployed: 3 }, allFresh);
  assert.ok(find(items, 'git-status'));
  assert.ok(!find(items, 'deploy-release'));
});

test('готовый код — совет выложить', () => {
  assert.match(find(plan({ undeployed: 1 }, allFresh), 'deploy-release').why, /1 изменение/);
  assert.ok(!find(plan({ undeployed: 1, ahead: 1 }, allFresh), 'deploy-release'));
});

test('упавшая выкладка — срочно', () => {
  const runs = { ...allFresh, 'deploy-release': { at: NOW - 1000, code: 1, last: 'ВОРОТА: СТОП' } };
  assert.equal(find(plan({}, runs), 'deploy-release').level, 'urgent');
});

test('после выкладки: сначала ждём час, затем проверка, и нужен осмотр', () => {
  const fresh = { ...allFresh, 'deploy-release': { at: NOW - 600000, code: 0 }, 'prod-doctor': { at: NOW - 3600000, code: 0 } };
  assert.equal(find(plan({}, fresh), 'deploy-post').level, 'soon');
  assert.equal(find(plan({}, fresh), 'prod-doctor').level, 'today');
  const old = { ...fresh, 'deploy-release': { at: NOW - 7200000, code: 0 } };
  assert.equal(find(plan({}, old), 'deploy-post').level, 'today');
  const done = { ...old, 'deploy-post': { at: NOW - 1000, code: 0 } };
  assert.ok(!find(plan({}, done), 'deploy-post'));
});

test('ритм: каждый день — по календарю, раз в неделю и месяц — по сроку', () => {
  const yesterday = { ...allFresh, 'day-start': { at: NOW - 13 * 3600000, code: 0 } };
  assert.equal(find(plan({}, yesterday), 'day-start').level, 'today');
  const week = { ...allFresh, 'prod-doctor': { at: NOW - 8 * DAY, code: 0 } };
  assert.equal(find(plan({}, week), 'prod-doctor').level, 'soon');
  assert.ok(!find(plan({}, { ...allFresh, 'prod-drill': { at: NOW - 20 * DAY, code: 0 } }), 'prod-drill'));
});

test('одна команда — один пункт, самый важный', () => {
  const runs = { 'prod-doctor': { at: NOW - 8 * DAY, code: 1, bad: ['✗ x'] } };
  const list = plan({ site: false }, runs).filter((x) => x.cmd === 'prod-doctor');
  assert.equal(list.length, 1);
  assert.equal(list[0].level, 'urgent');
});

test('сделанное сегодня попадает в итог', () => {
  const { done } = advise(calm, { 'day-status': { at: NOW - 1000, code: 0 }, 'git-log': { at: NOW - 2 * DAY, code: 0 } }, COMMANDS, NOW);
  assert.deepEqual(done.map((d) => d.cmd), ['day-status']);
});

test('поручение с кнопкой уходит после успешного запуска, следующий шаг появляется', () => {
  const todo = [
    { id: 'a', added: '2026-10-31', title: 'Скачать', why: 'w', cmd: 'setup-backup' },
    { id: 'b', added: '2026-10-31', after: 'a', title: 'Стенд', why: 'w', cmd: 'night-up' },
  ];
  const you = (runs) => advise(calm, runs, COMMANDS, NOW, todo).items.filter((x) => x.level === 'you').map((x) => x.todo);
  assert.deepEqual(you(allFresh), ['a']);
  assert.deepEqual(you({ ...allFresh, 'setup-backup': { at: new Date('2026-10-20').getTime(), code: 0 } }), ['a'], 'старый запуск не считается');
  assert.deepEqual(you({ ...allFresh, 'setup-backup': { at: NOW, code: 1 } }), ['a'], 'сбой не считается');
  assert.deepEqual(you({ ...allFresh, 'setup-backup': { at: NOW, code: 0 } }), ['b']);
});

test('ручное поручение закрывается кнопкой «Сделано»', () => {
  const t = { id: 'm', added: '2026-10-31', title: 'Снять', why: 'w', link: 'https://x' };
  assert.equal(todoDone(t, {}), false);
  assert.equal(todoDone(t, { 'todo:m': { at: NOW, code: 0 } }), true);
  const [item] = advise(calm, allFresh, COMMANDS, NOW, [t]).items;
  assert.equal(item.cmd, undefined);
  assert.equal(item.link, true);
});

test('pult/todo.json корректен: кнопка есть, шаги связаны', () => {
  const todo = JSON.parse(fs.readFileSync(new URL('../todo.json', import.meta.url), 'utf8'));
  assert.equal(new Set(todo.map((t) => t.id)).size, todo.length);
  for (const t of todo) {
    assert.ok(t.title && t.why && !Number.isNaN(Date.parse(t.added)), t.id);
    assert.ok(t.cmd || t.link, `${t.id}: нужна кнопка или ссылка`);
    if (t.cmd) assert.ok(COMMANDS.some((c) => c.id === t.cmd), t.cmd);
    if (t.after) assert.ok(todo.some((x) => x.id === t.after), t.after);
    if (t.link) assert.match(t.link, /^https:\/\//);
  }
});

test('у команд с ритмом есть причина', () => {
  for (const c of COMMANDS.filter((x) => x.every)) assert.ok(c.why, c.id);
});
