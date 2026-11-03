import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advise, runKey, todoDone } from '../advisor.mjs';
import { COMMANDS } from '../catalog.mjs';

const TODO = JSON.parse(readFileSync(new URL('../todo.json', import.meta.url), 'utf8'));

test('пункт дел с params: в совете есть params, закрывается только своим ключом', () => {
  const t = { id: 'a', added: '2026-10-31', cmd: 'day-errors', params: { hours: '24' } };
  const other = { [runKey('day-errors', { hours: '2' })]: { at: Date.now(), code: 0 }, 'day-errors': { at: Date.now(), code: 0 } };
  assert.equal(todoDone(t, other), false);
  assert.equal(todoDone(t, { [runKey('day-errors', { hours: '24' })]: { at: Date.now(), code: 0 } }), true);
});

test('todo.json: команда пункта есть в каталоге; select-параметры заполнены', () => {
  for (const t of TODO) {
    if (!t.cmd) continue;
    const c = COMMANDS.find((x) => x.id === t.cmd);
    assert.ok(c, `${t.id}: нет команды ${t.cmd} в каталоге пульта администратора`);
    for (const p of c.params || []) {
      if (p.type !== 'select') continue;
      assert.ok(t.params?.[p.name] != null && t.params[p.name] !== '', `${t.id}: нет params.${p.name}`);
    }
  }
});

test('совет передаёт params пункта в интерфейс', () => {
  const s = { site: true, route: 'vps' };
  const { items } = advise(s, {}, COMMANDS, Date.now(), [{ id: 'x', added: '2026-10-31', cmd: 'day-errors', params: { hours: '72' }, title: 't', why: 'w' }]);
  assert.deepEqual(items.find((i) => i.todo === 'x')?.params, { hours: '72' });
});

test('параметр часов — только из списка', async () => {
  const { validateParams } = await import('../dispatch.mjs');
  const cmd = COMMANDS.find((c) => c.id === 'day-errors');
  assert.throws(() => validateParams(cmd, { hours: '999' }), /Недопустимое/);
  assert.deepEqual(validateParams(cmd, { hours: '24' }), { hours: '24' });
});

test('todo.json: время постановки не в будущем — иначе пункт никогда не закроется запуском', () => {
  for (const t of TODO) assert.ok(Date.parse(t.added) <= Date.now(), `${t.id}: added ${t.added} в будущем`);
});
