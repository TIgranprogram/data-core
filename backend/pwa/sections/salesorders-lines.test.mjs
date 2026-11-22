import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('./salesorders.js');
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const permissions = [
  read('./order-archive.js').match(/^export const archivedOrder = .*;$/m)[0],
  read('./order-archive.js').match(/^export const canEditOrder = [\s\S]+?;$/m)[0],
  read('./order-line-actions.js').match(/^export const canChangeLines = .*;$/m)[0],
  source.match(/^const closedStage = .*;$/m)[0],
].join('\n').replace(/^export /gm, '');

const contract = (id, extra = {}) => ({ id, orderNo: id.toUpperCase(), stage: 'new', lines: [], ...extra });
const fixture = ({ canEditOrders = true, role = 'manager' } = {}) => {
  const patches = [], tabs = [];
  const h = (tag, opts, ...children) => ({ tag, opts, children });
  const stack = () => ({ children: [], append(...nodes) { this.children.push(...nodes.filter(Boolean)); } });
  const sandbox = vm.createContext({
    session: { canEditOrders, role, sees: () => true },
    h, stack, button: (opts) => h('button', opts), actions: (...nodes) => h('actions', {}, ...nodes),
    positionsTable: (opts) => h('positionsTable', opts), orderArchiveActions: () => [],
    attachLinePassports: () => ({ markOf: () => '', whenReady() {} }),
    reloadKeep: () => {}, distribBlock: () => null, produceBlock: () => null,
    kitRow: (opts) => h('kitRow', opts), badge: () => '', due: () => '', STAGE: {},
    seq: () => 1, cancelledRow: () => ({ cancelled: true }), posPic: () => '', ourLine: () => '', qty: String,
    canShip: () => false,
    patch: (value) => patches.push(value), goTab: (tab) => tabs.push(tab),
  });
  const methods = vm.runInContext(permissions + '\nconst editableOrder = canEditOrder;\n'
    + fragment('function linesLink(', '/** Блок «Готовность к отгрузке»')
    + fragment('const addLine =', '/** Вкладка «Деньги»')
    + '\n({ positionsPane, contractMenu, linesLink });', sandbox);
  const render = (orders) => methods.positionsPane({ stage: 'new', orders }, {});
  const findButtons = (node) => node?.tag === 'button' ? [node.opts] : (node?.children || []).flatMap(findButtons);
  const buttons = (table) => table.opts.groups.flatMap((group) => findButtons(group.foot));
  const menu = (order, prefix) => methods.contractMenu(order, undefined, prefix).find((item) => item.label.includes('+ Позиция'));
  return { ...methods, render, buttons, findButtons, menu, patches, tabs };
};

test('у пустого заказа одна кнопка, она открывает создание с ID договора', () => {
  const { render, buttons, findButtons, menu, patches } = fixture();
  const row = contract('a');
  const pane = render([row]);
  assert.equal(findButtons(pane).length, 0);
  const [button] = buttons(pane.children[0]);
  assert.equal(button.label, '+ Позиция');
  assert.equal(buttons(pane.children[0]).length, 1);
  assert.equal(menu(row), undefined);
  button.onClick();
  assert.equal(patches[0].of, 'orders');
  assert.equal(patches[0].new, '1');
  assert.equal(patches[0].orderId, 'a');
});

test('несколько договоров: пустые и отменённые имеют адресные кнопки, заполненный — пункт меню', () => {
  const { render, buttons, menu, patches } = fixture();
  const a = contract('a');
  const b = contract('b', { lines: [{ id: 'old', cancelledAt: '2026-11-21' }] });
  const c = contract('c', { lines: [{ id: 'live', title: 'Скамья', qty: 1 }] });
  const [table] = render([a, b, c]).children;
  const options = buttons(table);
  assert.equal(options.map((button) => button.label).join(', '), '+ Позиция в договор A, + Позиция в договор B');
  options.forEach((button) => button.onClick());
  assert.equal(table.opts.groups[1].rows[0].cancelled, true);
  assert.equal(table.opts.groups[2].rows[0].key, 'live');
  const item = menu(c, 'Договор C: ');
  assert.equal(item.label, 'Договор C: + Позиция');
  item.onSelect();
  assert.deepEqual(patches.map((p) => p.orderId), ['a', 'b', 'c']);
});

test('архив, чтение и ограничения этапа скрывают добавление, готовность помогает выбрать договор', () => {
  const archived = contract('archive', { activeArchiveVersion: 1 });
  const closed = contract('closed', { stage: 'closed' });
  const ready = contract('ready', { stage: 'ready' });
  const available = contract('a');
  const actor = fixture();
  const viewer = fixture({ canEditOrders: false, role: 'director' });
  assert.equal(actor.buttons(actor.render([archived, closed, ready]).children[0]).length, 0);
  assert.equal(actor.linesLink({ orders: [archived, closed, ready] }), null);
  assert.equal(viewer.buttons(viewer.render([available]).children[0]).length, 0);
  assert.equal(viewer.linesLink({ orders: [available] }), null);
  const click = (link) => link.opts.onclick({ preventDefault() {} });
  click(actor.linesLink({ orders: [archived, available] }));
  assert.equal(actor.patches[0].orderId, 'a');
  const choose = actor.linesLink({ orders: [available, contract('b')] });
  assert.match(choose.children[0], /Выбрать договор/);
  click(choose);
  assert.deepEqual(actor.tabs, ['pos']);
  assert.equal(actor.patches.length, 1);
});
