import { BadRequestException } from '@nestjs/common';
import { compose, evalCondition, legacyTemplateToBlocks, parseWhen, sectionItems } from './passport-compose';
import { cleanSections, checkSections } from './passport-sections-check';
import { promoteToOwn } from './passport-promote';
import { textsTree } from './passport-texts-tree';
import { WhenError } from '../../common/passport/traits';

const eq = (value: string) => ({ field: 'traits', op: 'eq', value });

describe('parseWhen → условие для evalCondition (C054 B2)', () => {
  it.each([
    ['', undefined],
    ['   ', undefined],
    [null, undefined],
    ['bolts', { all: [{ any: [eq('bolts')] }] }],
    ['bolts|welds', { all: [{ any: [eq('bolts'), eq('welds')] }] }],
    ['concrete !freestanding', { all: [{ any: [eq('concrete')] }, { any: [{ not: eq('freestanding') }] }] }],
  ])('%p', (src, cond) => {
    expect(parseWhen(src)).toEqual(cond);
  });

  it.each(['!', 'bolts|', '|welds', 'nope', '!nope', 'bolts  nope'])('ошибка %p', (src) => {
    expect(() => parseWhen(src)).toThrow(WhenError);
  });

  it('значения по множеству признаков', () => {
    const t = (when: string, traits: string[]) => evalCondition(parseWhen(when), { traits });
    expect(t('bolts', ['bolts'])).toBe(true);
    expect(t('bolts', [])).toBe(false);
    expect(t('bolts|welds', ['welds'])).toBe(true);
    expect(t('concrete !freestanding', ['concrete'])).toBe(true);
    expect(t('concrete !freestanding', ['concrete', 'freestanding'])).toBe(false);
    expect(t('!wood', [])).toBe(true);
    expect(t('', [])).toBe(true);
  });
});

describe('sectionItems — устойчивые коды пунктов (C054 B1)', () => {
  it('нет ids — p1…pN по позиции, нет when — null', () => {
    expect(sectionItems({ paragraphs: ['a', 'b'] })).toEqual([{ id: 'p1', text: 'a', when: null }, { id: 'p2', text: 'b', when: null }]);
  });
  it('ids и when подхватываются параллельно', () => {
    expect(sectionItems({ paragraphs: ['a', 'b'], ids: ['p1', 'p7w'], when: [null, 'bolts'] })).toEqual([{ id: 'p1', text: 'a', when: null }, { id: 'p7w', text: 'b', when: 'bolts' }]);
  });
  it('несовпадение длин и повтор кодов — ошибка в строгом режиме', () => {
    expect(() => sectionItems({ key: 'x', paragraphs: ['a', 'b'], ids: ['p1'] })).toThrow(/ids/);
    expect(() => sectionItems({ key: 'x', paragraphs: ['a', 'b'], when: ['bolts'] })).toThrow(/when/);
    expect(() => sectionItems({ key: 'x', paragraphs: ['a', 'b'], ids: ['p1', 'p1'] })).toThrow(/повторяются/);
  });
  it('при сборке повреждённые массивы не роняют паспорт — читаются как «нет»', () => {
    expect(sectionItems({ paragraphs: ['a', 'b'], ids: ['p1'], when: ['bolts'] }, false).map((i) => [i.id, i.when])).toEqual([['p1', null], ['p2', null]]);
  });
  it('сохранение: 400 на несовпадение длин и на неизвестный признак', () => {
    expect(() => checkSections([{ key: 'm', paragraphs: ['a', 'b'], ids: ['p1'] }])).toThrow(BadRequestException);
    expect(() => checkSections([{ key: 'm', paragraphs: ['a'], when: ['wrong'] }])).toThrow(/Неизвестный признак: wrong/);
    expect(() => checkSections([{ key: 'm', paragraphs: ['a'], when: ['bolts !welds'] }])).not.toThrow();
  });
});

describe('compose: when, неизвестные признаки, замена по коду', () => {
  const all = { sections: [{ key: 'm', title: '4 Монтаж', paragraphs: ['Общий.', 'Про болты.', 'Без болтов.', 'Про бетон.'], ids: ['p1', 'p2', 'p3', 'p4'], when: [null, 'bolts', '!bolts', 'concrete'] }] };
  const run = (traits: string[], unknownTraits: string[] = []) => compose(legacyTemplateToBlocks(all), { traits }, 'BLG', { unknownTraits });
  const texts = (r: ReturnType<typeof run>) => r.sections.flatMap((s) => s.items.map((i) => i.text));

  it('условия по признакам; excluded называет раздел, код и условие', () => {
    const r = run(['bolts']);
    expect(texts(r)).toEqual(['Общий.', 'Про болты.']);
    expect(r.excluded).toEqual([{ section: 'm', key: 'p3', when: '!bolts' }, { section: 'm', key: 'p4', when: 'concrete' }]);
    expect(r.needJoints).toBe(false);
  });

  it('признак без ответа: пункты на bolts / !bolts не выводятся, нужен выбор «Конструкция»', () => {
    const r = run([], ['bolts', 'welds']);
    expect(texts(r)).toEqual(['Общий.']); // «!bolts» молча истиной не становится
    expect(r.excluded.filter((e) => e.unknown).map((e) => e.key)).toEqual(['p2', 'p3']);
    expect(r.needJoints).toBe(true);
  });

  it('нумерация после условий без дыр', () => {
    expect(run(['bolts', 'concrete']).sections[0].items.map((i) => i.number)).toEqual(['1.1', '1.2', '1.3']);
  });

  it('пункт категории заменяет «Для всех» по коду, а не по позиции, и встаёт на его место', () => {
    const allIns = { sections: [{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B (новый, вставлен)', 'C'], ids: ['p1', 'p7w', 'p2'] }] };
    const own = { sections: [{ key: 'm', title: 'Монтаж', paragraphs: ['C-своё'], ids: ['p2'] }] };
    const blocks = [...legacyTemplateToBlocks(allIns), ...legacyTemplateToBlocks(own).map((b) => ({ ...b, category: 'BLG' }))];
    const r = compose(blocks, {}, 'BLG');
    expect(r.sections[0].items.map((i) => i.text)).toEqual(['A', 'B (новый, вставлен)', 'C-своё']);
  });

  it('дерево текстов: замена и «заменяет» ищутся по коду', () => {
    const allIns = { sections: [{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B', 'C'], ids: ['p1', 'p7w', 'p2'] }] };
    const own = { sections: [{ key: 'm', title: 'Монтаж', paragraphs: ['C-своё'], ids: ['p2'] }] };
    const items = textsTree(allIns, own)[0].items;
    expect(items.map((i) => [i.key, i.origin])).toEqual([['p1', 'all'], ['p7w', 'all'], ['p2', 'override']]);
    expect(items[2].allText).toBe('C');
    expect(items[2].allIndex).toBe(2);
  });
});

describe('promoteToOwn по коду (C054)', () => {
  const all = [{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B', 'C'], ids: ['p1', 'p7w', 'p2'], when: [null, 'bolts', null] as Array<string | null> }];
  it('пункт с особым кодом в середине раздела: добавляется в раздел категории с кодом и условием', () => {
    const r = promoteToOwn(null, all, 'm', 'p7w', 'B-своё');
    expect(r[0]).toMatchObject({ paragraphs: ['B-своё'], ids: ['p7w'], when: ['bolts'] });
  });
  it('обычный p2 за вставленным пунктом — тоже по коду, не по позиции', () => {
    const r = promoteToOwn(null, all, 'm', 'p2', 'C-своё');
    expect(r[0]).toMatchObject({ paragraphs: ['C-своё'], ids: ['p2'] });
  });
  it('повторная правка уже заменённого пункта — на месте', () => {
    const r1 = promoteToOwn(null, all, 'm', 'p7w', 'v1');
    expect(promoteToOwn(r1, all, 'm', 'p7w', 'v2')[0].paragraphs).toEqual(['v2']);
  });
  it('неизвестный код — 400', () => {
    expect(() => promoteToOwn(null, all, 'm', 'zzz', 't')).toThrow(BadRequestException);
  });
});

describe('cleanSections — правка текста не стирает коды и условия', () => {
  const stored = [{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B'], ids: ['p1', 'p7w'], when: [null, 'bolts'] as Array<string | null> }];
  it('редактор прислал только тексты (то же число) — ids и when берутся из сохранённого', () => {
    const r = cleanSections([{ key: 'm', title: 'Монтаж', paragraphs: ['A2', 'B2'] }], stored);
    expect(r[0]).toEqual({ key: 'm', title: 'Монтаж', paragraphs: ['A2', 'B2'], ids: ['p1', 'p7w'], when: [null, 'bolts'] });
  });
  it('пустой пункт убирается вместе со своим кодом и условием', () => {
    const r = cleanSections([{ key: 'm', title: 'Монтаж', paragraphs: ['A', '  ', 'C'], ids: ['p1', 'p2', 'p3'], when: [null, 'bolts', 'welds'] }]);
    expect(r[0]).toMatchObject({ paragraphs: ['A', 'C'], ids: ['p1', 'p3'], when: [null, 'welds'] });
  });
  it('число пунктов изменилось и ids не присланы — прежние p1…pN по позиции (без ids)', () => {
    const r = cleanSections([{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B', 'C'] }], stored);
    expect(r[0].ids).toBeUndefined();
  });
  it('длины не совпали — 400', () => {
    expect(() => cleanSections([{ key: 'm', title: 'Монтаж', paragraphs: ['A', 'B'], ids: ['p1'] }])).toThrow(BadRequestException);
  });
});
