import test from 'node:test';
import assert from 'node:assert/strict';
import { planMaterialsProposal } from './materials-proposal.js';

const source = (id, name = 'Стойка') => ({ kind: 'part', refId: id, name, code: 'СТ.01', path: [{ kind: 'module', refId: 'm1', name: 'Рама', lineId: 'line-' + id }, { kind: 'raw', refId: 'r1', name: 'Труба' }] });
const row = (id, extra = {}) => ({ materialId: 'steel', sizes: ['∅89×3'], partIds: [], sourceRefs: [source(id)], ...extra });

test('разные детали с одинаковым названием остаются разными источниками, повтор не дублирует', () => {
  const proposal = { rows: [row('a'), row('b')], coatingIds: [] };
  const first = planMaterialsProposal(null, proposal);
  assert.equal(first.added, 2);
  assert.equal(first.spec.rows.length, 2);
  const again = planMaterialsProposal(first.spec, proposal);
  assert.equal(again.added, 0);
  assert.equal(again.spec.rows.length, 2);
});
test('изменения по источнику показываются, ручные тексты и размеры сохраняются', () => {
  const current = { rows: [row('a', { materialId: 'wood', sizes: ['200×40'], passportText: 'Свой паспорт', techText: 'Своё техописание' })], coatingIds: ['paint'], coatingTexts: [{ materialId: 'paint', techText: 'Своя окраска' }] };
  const proposal = { rows: [row('a', { sourceRefs: [source('a', 'Опора')] }), row('b')], coatingIds: ['paint', 'oil'], coatingTexts: [{ materialId: 'paint', techText: 'Другой текст' }, { materialId: 'oil', techText: 'Масло' }] };
  const plan = planMaterialsProposal(current, proposal);
  assert.equal(plan.spec.rows[0].materialId, 'wood');
  assert.deepEqual(plan.spec.rows[0].sizes, ['200×40']);
  assert.equal(plan.spec.rows[0].passportText, 'Свой паспорт');
  assert.equal(plan.spec.rows[0].techText, 'Своё техописание');
  assert.equal(plan.spec.rows[0].sourceRefs[0].name, 'Опора');
  assert.equal(plan.reports[0].changes[0].field, 'materialId');
  assert.deepEqual(plan.spec.coatingTexts, [{ materialId: 'paint', techText: 'Своя окраска' }, { materialId: 'oil', techText: 'Масло' }]);
  assert.equal(plan.added, 1);
  assert.equal(planMaterialsProposal(plan.spec, proposal).added, 0);
});
test('пустой BOM сохраняет старое описание с явным отсутствующим источником', () => {
  const current = { rows: [row('a', { techText: 'Свой текст' })], coatingIds: ['paint'] };
  const plan = planMaterialsProposal(current, null);
  assert.deepEqual(plan.spec.rows, current.rows);
  assert.deepEqual(plan.spec.coatingIds, current.coatingIds);
  assert.equal(plan.reports[0].missing, true);
});
test('неопределённый материал остаётся существующим источником, а ручная строка не склеивается по имени', () => {
  const current = { rows: [row('a'), { materialId: 'steel', sizes: ['∅89×3'], partIds: [] }], coatingIds: [] };
  const plan = planMaterialsProposal(current, { rows: [row('b')], coatingIds: [] }, [source('a')]);
  assert.equal(plan.reports.some((r) => r.missing), false);
  assert.equal(plan.spec.rows.length, 3);
});

test('101 источник сохраняется в двух серверных строках 100+1, повтор не склеивает и не дублирует', () => {
  const refs = Array.from({ length: 101 }, (_, i) => source('p' + i));
  const proposal = { rows: [row('unused', { sourceRefs: refs.slice(0, 100) }), row('unused', { sourceRefs: refs.slice(100) })], coatingIds: [] };
  const first = planMaterialsProposal(null, proposal);
  assert.equal(first.spec.rows.length, 2);
  assert.deepEqual(first.spec.rows.map((r) => r.sourceRefs.length), [100, 1]);
  const again = planMaterialsProposal(first.spec, proposal);
  assert.equal(again.added, 0);
  assert.deepEqual(again.spec.rows.map((r) => r.sourceRefs.length), [100, 1]);
});
