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
  assert.ok(!find(items, 'git-status'), 'незакоммиченное — плашка сверху, не пункт дел');
  assert.ok(!find(items, 'deploy-release'));
});

test('готовый код — совет выложить', () => {
  assert.match(find(plan({ undeployed: 1 }, allFresh), 'deploy-release').why, /1 изменение/);
  assert.ok(!find(plan({ undeployed: 1, ahead: 1 }, allFresh), 'deploy-release'));
});

test('упавшая выкладка — срочно, если код ещё не на сайте', () => {
  const runs = { ...allFresh, 'deploy-release': { at: NOW - 1000, code: 1, last: 'ВОРОТА: СТОП' } };
  assert.equal(find(plan({ undeployed: 2, version: 'abc' }, runs), 'deploy-release').level, 'urgent');
  assert.ok(!find(plan({ undeployed: 0, version: 'abc' }, runs), 'deploy-release'), 'сайт уже свежий — не тревожить');
  assert.ok(!find(plan({ undeployed: 0, version: undefined }, runs), 'deploy-release'), 'без версии сайта не предлагать повтор');
  assert.ok(!find(plan({ undeployed: 2, version: 'abc', gateFiles: ['backend/a.ts'] }, runs), 'deploy-release'), 'закрытые ворота не предлагать обойти');
});

test('поручение выложить уходит само, когда код уже на сайте', () => {
  const todo = [
    { id: 'deploy-admin-audit', added: '2026-10-31T19:10:00', title: 'Выложить', why: 'w', cmd: 'deploy-release' },
    { id: 'next', added: '2026-11-01', after: 'deploy-admin-audit', title: 'Склады', why: 'w', cmd: 'day-data' },
  ];
  const you = (s) => advise({ ...calm, ...s }, allFresh, COMMANDS, NOW, todo).items.filter((x) => x.level === 'you');
  assert.deepEqual(you({ undeployed: 3, version: 'old' }).map((x) => x.todo), ['deploy-admin-audit']);
  assert.deepEqual(you({ undeployed: 0, version: 'bc9f98fe' }).map((x) => x.todo), ['next']);
  assert.deepEqual(you({ undeployed: 0 }).map((x) => x.todo), ['deploy-admin-audit'], 'без version.json не закрывать');
});

test('после выкладки: пока час не прошёл — проверку не показываем; потом today и осмотр', () => {
  const fresh = { ...allFresh, 'deploy-release': { at: NOW - 600000, code: 0 }, 'prod-doctor': { at: NOW - 3600000, code: 0 } };
  assert.ok(!find(plan({}, fresh), 'deploy-post'), 'час ещё не прошёл — пункта нет');
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
  const { done } = advise(calm, { 'day-status': { at: NOW - 1000, code: 0 }, 'git-pull': { at: NOW - 2 * DAY, code: 0 } }, COMMANDS, NOW);
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
    assert.ok(t.cmd || t.link || t.manual === true, `${t.id}: нужна кнопка, ссылка или явный ручной шаг`);
    if (t.manual) assert.ok(!t.cmd, `${t.id}: ручной шаг не должен запускать команду`);
    if (t.cmd) assert.ok(COMMANDS.some((c) => c.id === t.cmd), t.cmd);
    if (t.after) assert.ok(todo.some((x) => x.id === t.after), t.after);
    if (t.link) assert.match(t.link, /^https:\/\//);
  }
});

test('release checklist: готовность → ворота → отдельно подтверждаемая выкладка', () => {
  // Завершённый выпуск снимается из живого todo; механизм зависимости проверяется собственной фикстурой.
  const flow = [
    { id: 'release-invoices-ready', added: '2026-11-03T08:02:00+03:00', title: 'Готовность', why: 'Проверено', manual: true },
    { id: 'release-invoices-gate', added: '2026-11-03T08:02:00+03:00', title: 'Ворота', why: 'Не обходить', after: 'release-invoices-ready', cmd: 'deploy-gate' },
    { id: 'release-invoices-publish', added: '2026-11-03T08:02:00+03:00', title: 'Выпуск', why: 'Подтверждение отдельно', after: 'release-invoices-gate', cmd: 'deploy-release' },
  ];
  assert.deepEqual(flow.map((t) => t.id), ['release-invoices-ready', 'release-invoices-gate', 'release-invoices-publish']);
  assert.equal(flow[0].manual, true);
  assert.equal(flow[1].after, flow[0].id);
  assert.equal(flow[1].cmd, 'deploy-gate');
  assert.equal(flow[2].after, flow[1].id);
  assert.equal(flow[2].cmd, 'deploy-release');

  const now = Date.parse('2026-11-03T08:03:00+03:00');
  const visible = (runs) => advise(calm, runs, COMMANDS, now, flow).items.filter((x) => x.level === 'you').map((x) => x.todo);
  assert.deepEqual(visible(allFresh), [flow[0].id]);
  const ready = { ...allFresh, [`todo:${flow[0].id}`]: { at: now, code: 0 } };
  assert.deepEqual(visible(ready), [flow[1].id]);
  const gatePassed = { ...ready, 'deploy-gate': { at: now, code: 0 } };
  assert.deepEqual(visible(gatePassed), [flow[2].id]);
});

test('последняя проверка с замечанием просит повторить её', () => {
  const runs = { ...allFresh, 'code-check': { at: NOW - 1000, code: 0, bad: ['✗ пульт: ОТСТАЛ'] } };
  const x = find(plan({}, runs), 'code-check');
  assert.equal(x.level, 'today');
  assert.match(x.why, /ОТСТАЛ/);
  assert.equal(advise(calm, runs, COMMANDS, NOW).check.cmd, 'code-check');
});

test('упавшая проверка становится первым делом', () => {
  const runs = { ...allFresh, 'check-full': { at: NOW - 500, code: 1, last: 'e2e: 3 failed' }, 'code-check': { at: NOW - 5000, code: 0 } };
  assert.equal(find(plan({}, runs), 'check-full').level, 'urgent');
  assert.equal(advise(calm, runs, COMMANDS, NOW).check.cmd, 'check-full');
});

test('зелёная проверка не добавляет дело и остаётся в итоге', () => {
  const runs = { ...allFresh, 'code-check': { at: NOW - 1000, code: 0, bad: [], last: 'ОК' } };
  assert.ok(!find(plan({}, runs), 'code-check'));
  assert.equal(advise(calm, runs, COMMANDS, NOW).check.code, 0);
});

test('запущенные стенды видны с кнопкой остановки', () => {
  const items = plan({ nightStand: true, localSite: true }, allFresh);
  assert.equal(find(items, 'night-down').level, 'soon');
  assert.equal(find(items, 'stand-down').level, 'soon');
  assert.ok(!find(plan({}, allFresh), 'night-down'));
});

test('у команд с ритмом есть причина', () => {
  for (const c of COMMANDS.filter((x) => x.every)) assert.ok(c.why, c.id);
});
