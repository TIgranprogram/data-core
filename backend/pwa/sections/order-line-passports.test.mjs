import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./order-line-passports.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
function harness({ failPlan = false } = {}) {
  const calls = [];
  const sandbox = vm.createContext({
    api: async (path, opts) => {
      calls.push({ path, opts });
      if (path === '/passports') return { items: [{ id: 'old', incomeId: 'line', status: 'issued', passportNumber: '100' }] };
      if (failPlan) throw new Error('Нет доступа к состоянию');
      return { lines: [{ incomeId: 'line', source: 'attachment', state: 'blocked', selection: { mode: 'attachment' }, attachment: { available: false } }] };
    },
    statusOf: (p) => p.status, numberOf: (p) => p.passportNumber,
    attachmentSource: (v) => v?.source === 'attachment',
    button: (attrs) => ({ kind: 'button', attrs }),
    h: (tag, attrs, ...children) => ({ tag, attrs, children }),
  });
  vm.runInContext(source, sandbox);
  return { sandbox, calls };
}

test('один plan на уникальный заказ, история сохраняется отдельно от attachment source', async () => {
  const { sandbox, calls } = harness();
  const map = await sandbox.loadPassportsByIncome(['order', 'order']);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((c) => c.path.endsWith('/plan')).length, 1);
  assert.equal(map.get('line')[0].id, 'old');
  assert.equal(map.get('line').sourceView.state, 'blocked');
});

test('пропавший attachment не подменяется историческим номером сайта в строке', async () => {
  const { sandbox } = harness();
  const map = await sandbox.loadPassportsByIncome(['order']);
  const mark = sandbox.passportMark(map.get('line'));
  assert.equal(mark.attrs.label, 'Паспорт — нужен файл');
  assert.equal(sandbox.primaryPassport(map.get('line')).id, 'old');
});

test('ошибка source plan выходит наружу и не объявляет историю текущей готовностью', async () => {
  const { sandbox } = harness({ failPlan: true });
  await assert.rejects(sandbox.loadPassportsByIncome(['order']), /Нет доступа к состоянию/);
});
