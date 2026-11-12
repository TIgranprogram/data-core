import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeEl } from './test-vm.mjs';

/** C096 Э4: единственная группа пропущенного шага — эффективный выбор; ноль или неоднозначность — нет. */
async function steps(resp) {
  const mod = await load(new URL('./pick-steps.js', import.meta.url), {
    '../../../ui/kit/index.js': { funnel: () => ({ el: fakeEl(), update() {}, ready: () => true, setNext() {} }) },
    './api.js': { funnelData: async () => resp },
  });
  const ps = mod.pickSteps({ getQ: () => '' });
  await ps.update({});
  return ps;
}
const cat = { key: 'category', label: 'Категория', skip: true, values: [{ id: 'TRN', label: 'Тренажёры', count: 5 }], none: 0 };

test('единственная группа (шаг пропущен) — её id и название', async () => {
  const ps = await steps({ steps: [cat, { key: 'group', label: 'Группа', skip: true, values: [{ id: 'g1', label: 'Силовые', count: 5 }], none: 0 }] });
  assert.equal(JSON.stringify(ps.effective('group')), JSON.stringify({ id: 'g1', label: 'Силовые' }));
  assert.equal(JSON.stringify(ps.effective('category')), JSON.stringify({ id: 'TRN', label: 'Тренажёры' }));
  assert.equal(ps.valuesOf('group').join(), 'Силовые');
});

test('нет групп или есть изделия без группы — группа не подставляется', async () => {
  assert.equal((await steps({ steps: [cat, { key: 'group', skip: true, values: [], none: 0 }] })).effective('group'), null);
  assert.equal((await steps({ steps: [cat, { key: 'group', skip: true, values: [{ id: 'g1', label: 'Силовые' }], none: 2 }] })).effective('group'), null);
});

test('несколько групп без выбора — нет эффективной группы', async () => {
  const ps = await steps({ steps: [cat, { key: 'group', skip: false, values: [{ id: 'g1', label: 'А' }, { id: 'g2', label: 'Б' }], none: 0 }] });
  assert.equal(ps.effective('group'), null);
  assert.equal(ps.valuesOf('group').join(), 'А,Б');
});
