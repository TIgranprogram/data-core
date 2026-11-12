/* eslint-disable @typescript-eslint/no-var-requires */
const texts = require('../../../scripts/c094-texts-v3.js');
const traits = require('../../../scripts/c094-traits.js');
const materials = require('../../../scripts/c094-materials.js');
const code = require('../../../scripts/passport-texts.v2.json');
import { whenProblem } from '../../common/passport/traits';

/** C094: скрипты данных (условия текстов, признаки видов, материалы) — чистые части. */
describe('c094-texts-v3: условия пунктов', () => {
  const prodAll = {
    sections: [
      { key: 'mounting', title: '3', paragraphs: ['Монтаж.', 'Место: нет корней деревьев.', 'Вокруг изделия оставляют свободное пространство (зону безопасности); приложение к паспорту.', 'Концы анкеров закрывают.'] },
      { key: 'storage', title: '5', paragraphs: ['1', '2', '3', '4', '5', '6', 'Коррозия, гниение древесины и отслаивание покрытия.'], ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], when: [null, null, null, null, null, null, 'wood'] },
    ],
  };
  const rules = [
    ['ALL_V2', 'mounting', 'p2', 'корней деревьев', '!atTree'],
    ['ALL_V2', 'mounting', 'p3', 'зону безопасности', 'users'],
    ['ALL_V2', 'mounting', 'p4', 'анкеров', 'anchors'],
    ['ALL_V2', 'storage', 'p7', 'гниение древесины', 'metal|wood'],
  ];
  it('ставит только условия: тексты и порядок не меняются, ids явные', () => {
    const r = texts.applyRules(prodAll.sections, rules);
    const m = r.sections[0];
    expect(m.paragraphs).toEqual(prodAll.sections[0].paragraphs);
    expect(m.ids).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(m.when).toEqual([null, '!atTree', 'users', 'anchors']);
    expect(r.items.map((i: { state: string }) => i.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });
  it('исправляет известную ошибку wood → metal|wood, чужое условие не трогает', () => {
    const r = texts.applyRules(prodAll.sections, rules);
    expect(r.sections[1].when[6]).toBe('metal|wood');
    const hand = texts.applyRules([{ ...prodAll.sections[1], when: [null, null, null, null, null, null, 'bolts'] }], rules);
    expect(hand.items.find((i: { key: string }) => i.key === 'storage').state).toBe('hand');
    expect(hand.sections[0].when[6]).toBe('bolts');
  });
  it('текст пункта правили — пропуск; повтор ничего не меняет', () => {
    const edited = texts.applyRules([{ ...prodAll.sections[0], paragraphs: ['Монтаж.', 'Другое.', 'Зона.', 'Анкеры.'] }], rules);
    expect(edited.items.every((i: { state: string }) => i.state === 'text' || i.state === 'missing')).toBe(true);
    const first = texts.applyRules(prodAll.sections, rules);
    const again = texts.applyRules(first.sections, rules);
    expect(again.items.every((i: { state: string }) => i.state === 'same')).toBe(true);
    expect(again.sections).toEqual(first.sections);
  });
  it('все условия правил — допустимые признаки, метки находятся в текстах кода', () => {
    for (const [, , , , when] of texts.RULES) expect(whenProblem(when)).toBeNull();
    for (const [cat, key, pid, mark] of texts.RULES) {
      const sec = code[cat === 'ALL_V2' ? 'ALL' : cat].sections.find((s: { key: string }) => s.key === key);
      const i = sec.ids.indexOf(pid);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sec.paragraphs[i].toLowerCase()).toContain(mark.toLowerCase());
    }
  });
  it('код JSON держит те же условия, что и скрипт', () => {
    for (const [cat, key, pid, , when] of texts.RULES) {
      const sec = code[cat === 'ALL_V2' ? 'ALL' : cat].sections.find((s: { key: string }) => s.key === key);
      expect(sec.when[sec.ids.indexOf(pid)]).toBe(when);
    }
  });
});

describe('c094-traits: признаки видов', () => {
  const rows = [{ _id: 1, name: 'Урна', traits: '' }, { _id: 2, name: 'Лестница', traits: 'moving' }, { _id: 3, name: 'Горка', traits: 'landing' }];
  it('добавляет к стоящим, повтор — без изменений, отсутствующий вид — пропуск', () => {
    const p = traits.plan(rows);
    const by = (n: string) => p.find((x: { name: string }) => x.name === n);
    expect(by('Урна').now).toBe('bin');
    expect(by('Лестница').now).toBe('moving, guards, landing');
    expect(by('Горка').state).toBe('same');
    expect(by('Турник').state).toBe('missing');
  });
  it('все признаки из таблицы допустимы', () => {
    for (const add of Object.values(traits.TRAITS) as string[][]) expect(whenProblem(add.join(' '))).toBeNull();
  });
});

describe('c094-materials: вывод материала', () => {
  const mats = [
    { id: 'steel', code: 'STEEL', name: 'Сталь' },
    { id: 'pipe', code: 'PIPE', name: 'Труба стальная' },
    { id: 'wood', code: 'WOOD', name: 'Древесина хвойных пород' },
  ];
  const prod = (o: Record<string, unknown>) => ({ _id: 'x', sku: 'A', name: 'Изделие', passportDefaults: {}, ...o });
  it('по таблице материалов изделия, дубли убираются', () => {
    const r = materials.derive(prod({ materialsSpec: { rows: [{ materialId: 'wood' }, { materialId: 'wood' }], coatingIds: ['pipe', 'нет'] } }), mats);
    expect(r).toMatchObject({ state: 'ok', ids: ['wood', 'pipe'] });
  });
  it('по названию — только явный металл без слов дерева', () => {
    expect(materials.derive(prod({ name: 'Скамья стальная' }), mats).ids).toEqual(['steel']);
    expect(materials.derive(prod({ name: 'Скамья стальная с деревянным сиденьем' }), mats).state).toBe('unclear');
    expect(materials.derive(prod({ name: 'Брусья параллельные' }), mats).why).not.toMatch(/дерево/);
    expect(materials.derive(prod({ name: 'Урна' }), mats).state).toBe('unclear');
  });
  it('заполненное не меняется, изделия без умолчаний паспорта в план не входят', () => {
    expect(materials.derive(prod({ passportDefaults: { materialIds: ['a'] } }), mats).state).toBe('filled');
    const plan = materials.buildPlan([prod({ name: 'Урна' }), { _id: 'y', sku: 'B', name: 'Услуга' }], mats);
    expect(plan.map((r: { sku: string }) => r.sku)).toEqual(['A']);
  });
});
