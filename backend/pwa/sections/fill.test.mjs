import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./fill.js', import.meta.url), 'utf8')
  .replace(/^import .+;\s*$/gm, '').replace(/^export /gm, '');

function h(tag, attrs, ...children) {
  return {
    tag, attrs, children: children.filter(Boolean), value: String(attrs?.value ?? ''),
    classList: { remove() {} },
    replaceChildren(...items) { this.children = items.filter(Boolean); },
  };
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

async function mount(group) {
  const writes = [], routes = [], operations = [];
  const mountFill = runInNewContext(source + '\nmountFill;', {
    h,
    api: async (path, options) => {
      if (path === '/fill-audit') return { total: group.count, groups: [group] };
      if (path === '/finance/needs-fill') return {};
      writes.push({ path, options });
      return { id: 'r2' };
    },
    session: { canMoney: true, sees: () => false },
    patch: route => routes.push(route),
    qty: n => String(n),
    opThumb: () => null,
    toast() {},
    toastError(error) { throw error; },
    empty: () => h('div', {}),
    button: ({ label, onClick }) => h('button', { onclick: onClick }, label),
    withReason: callback => callback(),
    requestInvoiceOperation: (id, operation) => operations.push([id, operation]),
  });
  const { el } = mountFill({ g: group.key });
  await new Promise(resolve => setImmediate(resolve));
  return { el, writes, routes, operations };
}

test('финансовая группа: связанная строка открывает счёт, свободная сохраняется быстрым вводом', async () => {
  const group = {
    key: 'exp-date', section: 'requests', field: 'invoiceDate', count: 2,
    quickPath: '/supply/requests', quick: ['invoiceNo', 'invoiceDate', 'priceHint'],
    items: [
      { id: 'r1', invoiceId: 'inv1', title: 'Труба' },
      { id: 'r2', title: 'Уголок', values: { invoiceNo: '15', priceHint: 100 } },
    ],
  };
  const { el, writes, routes, operations } = await mount(group);
  const linked = find(el, node => node.tag === 'li' && find(node, n => n.children.includes('Труба')));
  const unlinked = find(el, node => node.tag === 'li' && find(node, n => n.children.includes('Уголок')));
  assert.equal(find(linked, node => node.tag === 'input'), undefined);
  find(linked, node => node.tag === 'button' && node.children.includes('Открыть счёт')).attrs.onclick();
  assert.deepEqual({ ...routes[0] }, { of: 'invoicecard', open: 'inv1', fill: undefined, new: undefined });
  assert.equal(writes.length, 0);
  assert.equal(operations.length, 0);

  find(unlinked, node => node.tag === 'input' && node.attrs.type === 'date').value = '2026-11-21';
  await find(unlinked, node => node.tag === 'button' && node.children.includes('Сохранить')).attrs.onclick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/supply/requests/r2');
  assert.equal(writes[0].options.method, 'PATCH');
  assert.deepEqual({ ...writes[0].options.body }, { invoiceDate: '2026-11-21' });
});

test('наша компания связанной заявки заполняется через карточку счёта', async () => {
  const { el, routes, writes } = await mount({
    key: 'exp-company', section: 'requests', field: 'companyName', count: 1,
    items: [{ id: 'r1', invoiceId: 'inv1', title: 'Труба' }],
  });
  find(el, node => node.tag === 'button' && node.children.includes('Открыть счёт')).attrs.onclick();
  assert.deepEqual({ ...routes[0] }, { of: 'invoicecard', open: 'inv1', fill: undefined, new: undefined });
  assert.equal(writes.length, 0);
});

test('направление затрат открывает поле заявки', async () => {
  const { el, routes, writes } = await mount({
    key: 'exp-cost', section: 'requests', field: 'costCenter', count: 1,
    items: [{ id: 'r1', title: 'Труба' }],
  });
  find(el, node => node.tag === 'li').attrs.onkeydown({ key: 'Enter' });
  assert.deepEqual({ ...routes[0] }, { of: 'requests', open: 'r1', fill: 'costCenter', new: undefined });
  assert.equal(writes.length, 0);
});
