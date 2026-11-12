import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { createSession, facetsForGroup } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('./create-session.js', import.meta.url), 'utf8')).toString('base64'));

test('сбой после POST: повтор обновляет ту же запись и продолжает заполнение', async () => {
  const calls = []; let fail = true;
  const save = createSession({
    create: async (body) => { calls.push(['POST', body.name]); return { id: 'new' }; },
    update: async (id, body) => { calls.push(['PATCH', id, body.name]); return { id }; },
    complete: async (made) => { if (fail) { fail = false; throw new Error('Сбой умолчаний'); } return made; },
  });
  await assert.rejects(save({ name: 'Первое' }), /Изделие уже создано/);
  assert.equal((await save({ name: 'Уточнённое' })).id, 'new');
  assert.deepEqual(calls, [['POST', 'Первое'], ['PATCH', 'new', 'Уточнённое']]);
});

test('двойное нажатие ждёт одно создание', async () => {
  let release; let posts = 0;
  const save = createSession({ create: async () => { posts++; await new Promise((r) => { release = r; }); return { id: 'new' }; }, update: () => assert.fail(), complete: async (made) => made });
  const first = save({}); const second = save({});
  assert.equal(first, second); release();
  await Promise.all([first, second]); assert.equal(posts, 1);
});

test('сбой самого POST допускает новую попытку; чужие признаки не переходят в другую группу', async () => {
  let count = 0;
  const save = createSession({ create: async () => { if (++count === 1) throw new Error('Не создано'); return { id: 'new' }; }, update: () => assert.fail(), complete: async (made) => made });
  await assert.rejects(save({}), /Не создано/);
  assert.equal((await save({})).id, 'new');
  assert.deepEqual(facetsForGroup('А', 'А', ['f']), ['f']);
  assert.deepEqual(facetsForGroup('А', 'Б', ['f']), []);
});

test('после успешно записанных признаков и сбоя GET смена группы явно очищает прежние признаки', async () => {
  let fail = true; const writes = [];
  const save = createSession({ create: async () => ({ id: 'new' }), update: async (id) => ({ id }), complete: async (made, body) => {
    writes.push(facetsForGroup('А', body.group, ['facetA']));
    if (fail) { fail = false; throw new Error('GET'); }
    return made;
  } });
  await assert.rejects(save({ group: 'А' }));
  await save({ group: 'Б' });
  assert.deepEqual(writes, [['facetA'], []]);
});
