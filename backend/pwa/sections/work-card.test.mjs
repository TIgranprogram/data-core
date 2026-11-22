import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./work-card.js', import.meta.url), 'utf8')
  .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '');
const route = [
  { name: 'Резка', workTypeId: 'cut', state: 'done' },
  { name: 'Сварка', workTypeId: 'weld', state: 'current' },
  { name: 'Покраска', workTypeId: 'paint', state: 'next' },
];
const task = (status, stepIndex, extra = {}) => ({ id: 'work-11', code: 'W-11', status, stepIndex, route, ...extra });

function fixture(canEdit = true) {
  const moved = [], shown = [];
  const sandbox = vm.createContext({
    session: { canEdit }, screenCard: (config) => config, requestAnimationFrame() {},
    h: (tag, props, ...children) => ({ tag, props, children }),
    stack: (...children) => Object.assign(children, { replaceChildren() {} }), table: (config) => config,
    viewAsActive: () => false, busyBlock: () => null, section: (config) => config,
    taskDiscussion: () => ({ title: 'Обсуждение' }), api: async () => ({ photos: [] }), taskPhotos: () => null,
    toneBadge: (label) => label, hint: (text) => text, readonlyGroup: ({ rows }) => rows, sku: (text) => text, qty: String,
  });
  const create = vm.runInContext(source + '\nworkCard;', sandbox);
  const card = create({
    clean: (s) => s || '',
    nextStep: async (row) => { moved.push([row.id, 'next']); return { id: row.id, next: true }; },
    call: async (row, command) => { moved.push([row.id, command]); return { id: row.id, command }; },
  });
  return { card, moved, shown, ctx: { setRow: (row) => shown.push(row) } };
}

test('очередь, промежуточная и последняя операции имеют по одному основному переходу', async () => {
  const { card, ctx, moved, shown } = fixture();
  const waiting = task('waiting', null);
  const current = task('work', 1);
  const last = task('work', 2);
  assert.match(card.next(waiting, ctx).text, /Резка/);
  assert.equal(card.next(current, ctx).text, 'Покраска');
  assert.equal(card.next(last, ctx).primary.label, 'Завершить задание');
  for (const row of [waiting, current, last]) await card.next(row, ctx).primary.run();
  assert.deepEqual(moved, [['work-11', 'next'], ['work-11', 'next'], ['work-11', 'done']]);
  assert.equal(shown.length, 3);
  assert.equal(card.menu(last, ctx).filter(Boolean).some((item) => item.label.startsWith('Завершить')), false);
});

test('редкие переходы остаются в меню, наблюдатель читает без действий', async () => {
  const { card, ctx, moved } = fixture();
  const current = task('work', 1);
  for (const label of ['Завершить всё задание', 'Вернуть в ожидание']) {
    await card.menu(current, ctx).find((item) => item?.label === label).run();
  }
  const done = task('done', 3);
  assert.equal(card.next(done, ctx), null);
  await card.menu(done, ctx).find((item) => item.label === 'Вернуть в работу').run();
  assert.deepEqual(moved, [['work-11', 'done'], ['work-11', 'waiting'], ['work-11', 'paint']]);
  const cancelled = task('cancelled', 1, { cancelReason: 'Изменился заказ' });
  assert.equal(card.warns(cancelled)[0].sub, 'Изменился заказ');
  assert.equal(card.menu(cancelled, ctx).length, 0);
  const viewer = fixture(false);
  assert.equal(viewer.card.next(current, viewer.ctx), null);
  assert.equal(viewer.card.menu(current, viewer.ctx).length, 0);
});

test('маршрут использует состояние операции, исполнитель и нулевое количество показаны явно', () => {
  const { card } = fixture(false);
  const row = task('work', 1, { assigneeId: 'missing', qty: null });
  const [table, facts] = card.body(row, {}, []).filter(Boolean);
  assert.deepEqual(Array.from(card.body(row, {}, []).slice(-2), (block) => block.title), ['Фото', 'Обсуждение']);
  assert.equal(table.rows[1].selected, true);
  assert.equal(table.rows[1].cells[1], 'Сейчас');
  assert.equal(facts[0][1], 'Имя недоступно');
  assert.equal(facts[1][1], '');
  const [, zero] = card.body({ ...row, qty: 0, unit: 'шт' }, {}, []).filter(Boolean);
  assert.equal(zero[1][1], '0 шт');
});
