/* eslint-disable @typescript-eslint/no-var-requires */
const { buildPlan } = require('../../../scripts/c100-kinds.js');

/** C100: скрипт видов изделий — чистая часть (план). */
describe('c100-kinds: план', () => {
  const sec = { _id: 's1', name: 'Благоустройство', passportCategory: 'BLG' };
  const sport = { _id: 's2', name: 'Спорт', passportCategory: 'DSP' };
  const root = { _id: 'root', section: 'purpose', parentId: null };
  const leaf = { _id: 'leafA', parentId: 'root', text: 'Для отдыха.' };
  const g = (id: string, name: string, over: Record<string, unknown> = {}) => ({ _id: id, name, parentId: 's1', ...over });
  const prod = (cat: string, pd: unknown) => ({ categoryId: cat, passportDefaults: pd });
  const base = { sections: [sec, sport], phrases: [root, leaf], kinds: [] };

  it('вид по группе: категория из раздела, самые частые элементы и назначение; чужие группы не трогаем', () => {
    const plan = buildPlan({
      ...base, groups: [g('g1', 'Скамьи'), g('g2', 'Тренажёры')],
      products: [prod('g1', { elements: ['e1', 'e2'], textChoices: { root: 'leafA' } }), prod('g1', { elements: ['e1', 'e2'] }), prod('g1', { elements: ['e3'] }), prod('g1', undefined), prod('g2', { elements: ['e9'] })],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ group: 'Скамьи', kindName: 'Скамьи', category: 'BLG', elementIds: ['e1', 'e2'], purposeLeafId: 'leafA', products: 4, state: 'create' });
  });
  it('у изделий нет значений — вид получает только название и категорию', () => {
    const plan = buildPlan({ ...base, groups: [g('g1', 'Урны')], products: [prod('g1', undefined)] });
    expect(plan[0]).toMatchObject({ category: 'BLG', elementIds: [], purposeLeafId: '', state: 'create' });
  });
  it('идемпотентность: у группы вид уже есть — пропуск; такой вид уже заведён — используется, дубль не плодится', () => {
    expect(buildPlan({ ...base, groups: [g('g1', 'Урны', { passportKindId: 'k1' })], products: [] })[0]).toMatchObject({ state: 'skip', kindId: 'k1' });
    const reuse = buildPlan({ ...base, groups: [g('g1', 'Урны')], products: [], kinds: [{ _id: 'k2', name: 'урны', passportCategory: 'BLG' }] });
    expect(reuse[0]).toMatchObject({ state: 'reuse', kindId: 'k2' });
  });
  it('две группы «Качели» с разным содержимым получают виды с названием раздела', () => {
    const plan = buildPlan({
      ...base, groups: [g('g1', 'Качели'), g('g2', 'Качели', { parentId: 's2' })],
      products: [prod('g1', { elements: ['e1'] }), prod('g2', { elements: ['e2'] })],
    });
    expect(plan.map((r: { kindName: string }) => r.kindName)).toEqual(['Качели (Благоустройство)', 'Качели (Спорт)']);
  });
});
