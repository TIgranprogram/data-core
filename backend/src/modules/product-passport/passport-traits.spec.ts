import { buildV2Text } from './passport-v2-text';
import { collectTraits, filterByWhen, jointsMissing, whenVerdict } from './passport-traits';
import { resolveStyle } from './passport-pdf-v2-refs';

/**
 * C054, эталон «как паспорт 597»: решётка лежит на земле (нет бетона, анкеров, болтов, сварки), по ней можно ходить, приствольная.
 * Ни одна из 13 фраз, найденных в PDF 597, в текст не попадает; обратный набор (бетон, болты, сварка) их возвращает.
 */
const FORBIDDEN = ['опоры бетонируют', 'вертикальность стоек', 'анкеры и шпильки', 'нет корней деревьев', 'вставать запрещается', 'ослабление резьбовых',
  'трещины в сварных швах', 'отсутствие крепежа', 'проседания под опорами', 'изготовлено из стальной трубы', 'перед занятием', 'спортивная обувь', 'не раскачивайте'];

const all = {
  version: 1,
  sections: [
    { key: 'mounting', title: '4 Монтаж', paragraphs: ['Монтаж выполняют по схеме.', 'На площадке нет корней деревьев.', 'Опоры бетонируют в скважины.', 'Проверьте вертикальность стоек.', 'Анкеры и шпильки затягивают.'],
      ids: ['p1', 'p2', 'p3', 'p4', 'p5'], when: [null, '!atTree', 'concrete', 'concrete', 'anchors'] },
    { key: 'care', title: '6 Уход', paragraphs: ['Вставать запрещается.', 'Протирайте влажной тканью.'], ids: ['p1', 'p2'], when: ['!walkable', null] },
  ],
};
const dicts = (reverse: boolean) => ({
  elements: [{ _id: 'e1', code: 'GRATE', name: 'Приствольная решётка', traits: reverse ? '' : 'walkable, atTree' }],
  materials: [
    { _id: 'm1', code: 'LEAF', name: 'Сталь (лист)', madeOf: 'стального листа с порошковой окраской', traits: 'metal' },
    { _id: 'm2', code: 'PIPE', name: 'Сталь (труба)', madeOf: 'стальной трубы с порошковой окраской', traits: 'metal' },
  ],
  defects: [
    { _id: 'd1', code: 'LOOSE', name: 'Ослабление резьбовых соединений', applies: 'GRATE', period: 'ежемесячно', when: 'bolts' },
    { _id: 'd2', code: 'WELD', name: 'Трещины в сварных швах', applies: 'GRATE', period: 'ежемесячно', when: 'welds' },
    { _id: 'd3', code: 'FAST', name: 'Отсутствие крепежа', applies: 'GRATE', period: 'ежемесячно', when: 'bolts' },
    { _id: 'd4', code: 'CORR', name: 'Коррозия', applies: 'GRATE', period: 'ежемесячно' },
  ],
  install: [
    { _id: 'i1', code: 'LAID', name: 'Укладывается на основание', traits: 'freestanding', baseRequirements: 'Ровное плотное основание' },
    { _id: 'i2', code: 'CONCRETE', name: 'Бетонирование опор', traits: 'concrete, anchors', baseRequirements: 'Основание не допускает проседания под опорами' },
  ],
});
const grate597 = { name: 'Решётка приствольная', passportCategory: 'BLG', elements: ['e1'], materialIds: ['m1'], installationTypeId: 'i1', joints: ['solid'] };
const reverse = { ...grate597, materialIds: ['m2'], installationTypeId: 'i2', joints: ['bolts', 'welds'] };
const textOf = (t: ReturnType<typeof buildV2Text>) => JSON.stringify([t.sections, t.maintenance, t.install, t.description]).toLowerCase();

describe('эталон «как 597»: решётка на земле (C054)', () => {
  const t = buildV2Text({ passport: grate597, all, dicts: dicts(false) });

  it('ни одной из 13 запрещённых фраз', () => {
    const s = textOf(t);
    for (const bad of FORBIDDEN) expect(s).not.toContain(bad);
    expect(s).toContain('монтаж выполняют по схеме'); // общее осталось
    expect(s).toContain('коррозия');
    expect(s).toContain('ровное плотное основание');
  });

  it('снимок хранит признаки, откуда они, и что не вошло', () => {
    expect(t.traits).toEqual(['metal', 'freestanding', 'walkable', 'atTree']);
    expect(t.traitsFrom.atTree).toEqual(['Вид изделия: Приствольная решётка']);
    expect(t.traitsFrom.freestanding).toEqual(['Способ установки: Укладывается на основание']);
    expect(t.excluded.map((e) => `${e.section}/${e.key}`)).toEqual(['mounting/p2', 'mounting/p3', 'mounting/p4', 'mounting/p5', 'care/p1', 'maintenance/LOOSE', 'maintenance/WELD', 'maintenance/FAST']);
    expect(t.excluded.every((e) => !e.unknown)).toBe(true);
    expect(t.needJoints).toBe(false);
    expect(t.layout).toBe(2);
  });
});

describe('обратный набор: бетон, болты, сварка — пункты встали', () => {
  const t = buildV2Text({ passport: reverse, all, dicts: dicts(true) });
  it('все эти фразы на месте', () => {
    const s = textOf(t);
    for (const want of ['опоры бетонируют', 'вертикальность стоек', 'анкеры и шпильки', 'нет корней деревьев', 'вставать запрещается', 'ослабление резьбовых', 'трещины в сварных швах', 'отсутствие крепежа', 'проседания под опорами', 'стальной трубы']) expect(s).toContain(want);
    expect(t.excluded).toEqual([]);
  });
});

describe('соединения не выбраны — «неизвестно», а не «нет» (C054)', () => {
  const noJoints = { ...grate597, joints: undefined };
  const t = buildV2Text({ passport: noJoints, all: { ...all, sections: [...all.sections, { key: 'service', title: '5 ТО', paragraphs: ['Без болтов смотреть нечего.', 'Затяжка болтов.'], ids: ['p1', 'p2'], when: ['!bolts', 'bolts'] }] }, dicts: dicts(false) });
  it('пункты на болты и сварку не печатаются (в том числе «!bolts»), нужен выбор', () => {
    const s = textOf(t);
    expect(s).not.toContain('без болтов смотреть');
    expect(s).not.toContain('затяжка болтов');
    expect(s).not.toContain('ослабление резьбовых');
    expect(t.needJoints).toBe(true);
    expect(t.unknownTraits).toEqual(['bolts', 'welds']);
    expect(t.excluded.filter((e) => e.unknown).map((e) => `${e.section}/${e.key}`)).toEqual(['service/p1', 'service/p2', 'maintenance/LOOSE', 'maintenance/WELD', 'maintenance/FAST']);
  });
  it('«не хватает» для выпуска: Конструкция: выберите — только когда в тексте есть такие пункты', () => {
    expect(jointsMissing({ textSnapshot: t })).toEqual([expect.objectContaining({ label: 'Как соединены части (болты, сварка)', key: 'joints' })]);
    const plain = buildV2Text({ passport: noJoints, all: { version: 1, sections: [{ key: 'm', title: 'Монтаж', paragraphs: ['Общий.'] }] } });
    expect(plain.needJoints).toBe(false);
    expect(jointsMissing({ textSnapshot: plain })).toEqual([]);
    expect(jointsMissing({})).toEqual([]);
  });
});

describe('collectTraits / whenVerdict / filterByWhen', () => {
  it('три состояния соединений', () => {
    expect(collectTraits(undefined, { elements: [], materials: [], install: null }).unknown).toEqual(['bolts', 'welds']);
    expect(collectTraits(['solid'], { elements: [], materials: [], install: null })).toMatchObject({ unknown: [] });
    expect(collectTraits(['bolts'], { elements: [], materials: [], install: null })).toMatchObject({ unknown: [] });
    expect(collectTraits(['bolts'], { elements: [], materials: [], install: null }).traits).toContain('bolts');
    // способ установки сам несёт bolts — по нему ответ известен
    expect(collectTraits(undefined, { elements: [], materials: [], install: { name: 'Болтовое', traits: 'bolts' } }).unknown).toEqual(['welds']);
  });
  it('вердикт', () => {
    const info = { traits: ['wood'], unknown: ['bolts'] };
    expect(whenVerdict('', info)).toBe(true);
    expect(whenVerdict('wood', info)).toBe(true);
    expect(whenVerdict('metal', info)).toBe(false);
    expect(whenVerdict('!bolts', info)).toBe('unknown');
    expect(whenVerdict('сломано', info)).toBe(true); // повреждённая строка из базы запись не прячет
  });
  it('filterByWhen собирает excluded', () => {
    const ex: never[] = [];
    const r = filterByWhen([{ code: 'A', when: 'wood' }, { code: 'B', when: 'metal' }, { code: 'C' }], { traits: ['wood'], from: {}, unknown: [] }, 'maintenance', ex);
    expect(r.kept.map((d) => d.code)).toEqual(['A', 'C']);
    expect(ex).toEqual([{ section: 'maintenance', key: 'B', when: 'metal' }]);
  });
});

describe('пиктограммы обложки с when', () => {
  const rows = [
    { kind: 'пиктограмма правил', category: 'BLG', text: 'Перед занятием осмотрите изделие', when: 'moving' },
    { kind: 'пиктограмма правил', category: 'BLG', text: 'Спортивная обувь обязательна', when: 'moving' },
    { kind: 'пиктограмма правил', category: 'BLG', text: 'Не раскачивайте изделие', when: 'moving' },
    { kind: 'пиктограмма правил', category: 'BLG', text: 'Не залезайте на изделие', when: '!walkable' },
    { kind: 'пиктограмма правил', category: 'BLG', text: 'Общее правило' },
  ];
  it('решётка 597: подвижных частей нет, ходить можно — остаётся общее', () => {
    expect(resolveStyle(rows, 'BLG', { traits: ['walkable', 'atTree'] }).icons).toEqual(['Общее правило']);
  });
  it('подвижное и не для хождения — пиктограммы вернулись; признак без ответа — не выводится', () => {
    expect(resolveStyle(rows, 'BLG', { traits: ['moving'] }).icons).toHaveLength(5);
    expect(resolveStyle(rows, 'BLG', { traits: [], unknownTraits: ['moving'] }).icons).toEqual(['Не залезайте на изделие', 'Общее правило']);
  });
  it('в старом снимке без признаков пиктограммы без when не меняются', () => {
    expect(resolveStyle([rows[4]], 'BLG').icons).toEqual(['Общее правило']);
  });
});
