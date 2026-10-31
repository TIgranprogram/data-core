import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advise, runKey, todoDone } from '../advisor.mjs';
import { COMMANDS } from '../catalog.mjs';

const TODO = JSON.parse(readFileSync(new URL('../todo.json', import.meta.url), 'utf8'));

test('пункт дел со скриптом: в совете есть params, закрывается только своим скриптом', () => {
  const t = { id: 'a', added: '2026-10-31', cmd: 'script-apply', params: { script: 'series-dict-fill' } };
  const other = { [runKey('script-apply', { script: 'add-our-company' })]: { at: Date.now(), code: 0 }, 'script-apply': { at: Date.now(), code: 0 } };
  assert.equal(todoDone(t, other), false);
  assert.equal(todoDone(t, { [runKey('script-apply', { script: 'series-dict-fill' })]: { at: Date.now(), code: 0 } }), true);
});

test('todo.json: у каждой команды со скриптом указан скрипт, и он есть в backend/scripts', () => {
  for (const t of TODO) {
    const c = COMMANDS.find((x) => x.id === t.cmd);
    if (!c?.params?.some((p) => p.from === 'prodScripts')) continue;
    assert.ok(t.params?.script, `${t.id}: нет params.script — пульт запустит первый скрипт из списка`);
    readFileSync(new URL(`../../backend/scripts/${t.params.script}.js`, import.meta.url));
  }
});

test('совет передаёт params пункта в интерфейс', () => {
  const s = { site: true, route: 'vps' };
  const { items } = advise(s, {}, COMMANDS, Date.now(), [{ id: 'x', added: '2026-10-31', cmd: 'script-apply', params: { script: 'series-dict-fill' }, title: 't', why: 'w' }]);
  assert.deepEqual(items.find((i) => i.todo === 'x')?.params, { script: 'series-dict-fill' });
});
