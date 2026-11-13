// node --test tools/starozhil/lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { parseFront, pickNext, safePath, isDenied, trimMessages, sourcesHash, cardState } from './lib.mjs';

test('свойства наряда читаются', () => {
  const { meta, body } = parseFront('---\nid: 001-x\npriority: 2\nrepeat: true\nreads: [a.md, "b c"]\n---\n# Цель\n');
  assert.deepEqual(meta, { id: '001-x', priority: 2, repeat: true, reads: ['a.md', 'b c'] });
  assert.equal(body, '# Цель\n');
  assert.deepEqual(parseFront('без свойств').meta, {});
});

test('следующий наряд — по приоритету; готовый разовый не повторяется; повторный — по сроку', () => {
  const j = (id, meta) => ({ id, meta: { status: 'ready', ...meta } });
  const jobs = [j('002', { priority: 2 }), j('001', { priority: 1 }), j('003', { priority: 0, status: 'paused' }), j('004', { priority: 3, repeat: true, everyHours: 24 })];
  assert.equal(pickNext(jobs, []).id, '001');
  assert.equal(pickNext(jobs, [{ id: '001', at: 1, result: 'готово' }]).id, '002');
  assert.equal(pickNext(jobs, [{ id: '001', at: 1, result: 'не вышло' }]).id, '001'); // не вышло — повторить
  const now = 100 * 3600000;
  const done = [{ id: '001', at: 1, result: 'готово' }, { id: '002', at: 1, result: 'готово' }];
  assert.equal(pickNext(jobs, [...done, { id: '004', at: now - 3600000, result: 'готово' }], now), null);
  assert.equal(pickNext(jobs, [...done, { id: '004', at: now - 25 * 3600000, result: 'готово' }], now).id, '004');
});

test('модель не выходит за проект и не видит секреты', () => {
  const root = path.resolve('/proj');
  assert.equal(safePath(root, 'backend/src/a.ts'), path.join(root, 'backend/src/a.ts'));
  assert.equal(safePath(root, '../etc/passwd'), null);
  assert.equal(safePath(root, '.env'), null);
  assert.equal(safePath(root, 'deploy/synology/config.env'), null);
  assert.equal(safePath(root, 'deploy/synology/CREDENTIALS.md'), null);
  assert.equal(safePath(root, 'secrets/x'), null);
  assert.equal(safePath(root, 'backend/node_modules/x/index.js'), null);
  assert.equal(isDenied('tools/logs/a.png'), true);
  assert.equal(isDenied('docs/MAP.md'), false);
});

test('старые ответы инструментов сжимаются, правила и записи целы', () => {
  const big = 'строка1\n' + 'x'.repeat(500);
  const msgs = [{ role: 'system', content: big }, { role: 'user', content: big }, ...Array.from({ length: 6 }, () => ({ role: 'tool', content: big }))];
  const t = trimMessages(msgs, 4);
  assert.equal(t[0].content, big); assert.equal(t[1].content, big);
  assert.match(t[2].content, /старый ответ/); assert.match(t[3].content, /старый ответ/);
  assert.equal(t[4].content, big); assert.equal(t[7].content, big);
});

test('карточка: свежая, устарела, сломана', () => {
  const h = sourcesHash(['a\r\nb', 'c']);
  assert.equal(h, sourcesHash(['a\nb', 'c'])); // перевод строки Windows не меняет отпечаток
  assert.equal(sourcesHash(['a', null]), null);
  assert.equal(cardState({ sources: ['x'], hash: h }, h).state, 'ok');
  assert.equal(cardState({ sources: ['x'], hash: 'old' }, h).state, 'stale');
  assert.equal(cardState({ sources: ['x'] }, h).state, 'stale');
  assert.equal(cardState({ sources: ['x'], hash: h }, null).state, 'broken');
  assert.equal(cardState({}, h).state, 'broken');
});

test('факты по пунктам: пути, имена, коды задач', async () => {
  const { taskItems, itemTokens, checkRefs } = await import('./lib.mjs');
  const md = '# x\n- [ ] **Скорость:** `/me/counters` в `backend/src/main.ts`, C049-1 и АБЗ-3\n- [x] сделано\n  - [~] вложенный `ui/list.js`\n';
  const it = taskItems(md);
  assert.deepEqual(it.map((x) => [x.line, x.state]), [[2, 'открыт'], [4, 'частично']]);
  assert.deepEqual(itemTokens(it[0].text), [{ kind: 'text', v: '/me/counters' }, { kind: 'path', v: 'backend/src/main.ts' }, { kind: 'code', v: 'C049-1' }, { kind: 'code', v: 'АБЗ-3' }]);
  const r = checkRefs('см. backend/src/a.ts:10 и docs/x.md:500 и нет/такого.ts:1', (f) => ({ 'backend/src/a.ts': 20, 'docs/x.md': 100 })[f] ?? null);
  assert.equal(r.total, 3); assert.deepEqual(r.bad.map((b) => b.file), ['docs/x.md', 'нет/такого.ts']);
});

test('маршруты контроллера: префикс + метод', async () => {
  const { moduleRoutes } = await import('./lib.mjs');
  const src = "@Controller('supply')\nclass A {\n  @Get('lookups')\n  a() {}\n  @Patch(':id')\n  b() {}\n  @Post()\n  c() {}\n}";
  assert.deepEqual(moduleRoutes(src), [{ method: 'GET', path: 'supply/lookups', line: 3 }, { method: 'PATCH', path: 'supply/:id', line: 5 }, { method: 'POST', path: 'supply', line: 7 }]);
});
