import { textsTree } from './passport-texts-tree';
import { compose, legacyStartNumber, legacyTemplateToBlocks } from './passport-compose';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/** Дерево редактора «Разделы и тексты» (БЗ-6 Э2d): пометки «общий / категории / заменяет общий», порядок — как у сборщика. */
describe('textsTree', () => {
  const all = { sections: [
    { key: 'general', title: '3 Общие указания', paragraphs: ['3.1 Общий первый {std:R1}', '3.2 Общий второй'] },
    { key: 'service', title: '4 Обслуживание', paragraphs: ['Осмотр раз в квартал'] },
  ] };

  it('без версии категории — все пункты общие, номера с 3', () => {
    const t = textsTree(all, null);
    expect(t.map((s) => `${s.number} ${s.title}`)).toEqual(['3 Общие указания', '4 Обслуживание']);
    expect(t[0].items.map((i) => [i.number, i.origin, i.text])).toEqual([['3.1', 'all', '3.1 Общий первый {std:R1}'], ['3.2', 'all', '3.2 Общий второй']]);
    expect(t[0].ownSection).toBeNull();
    expect(t[0].allCount).toBe(2);
  });

  it('раздел категории с тем же ключом заменяет первые N пунктов; новый раздел — после раздела «Для всех» с тем же индексом', () => {
    const own = { sections: [
      { key: 'use', title: 'Правила', paragraphs: ['Свой 1', 'Свой 2'] },
      { key: 'general', title: 'Общие указания', paragraphs: ['Заменённый первый'] },
    ] };
    const t = textsTree(all, own);
    expect(t.map((s) => s.key)).toEqual(['general', 'use', 'service']);
    const g = t[0];
    expect(g.items.map((i) => i.origin)).toEqual(['override', 'all']);
    expect(g.items[0]).toMatchObject({ text: 'Заменённый первый', ownIndex: 0, allIndex: 0, allText: '3.1 Общий первый {std:R1}', number: '3.1' });
    expect(g).toMatchObject({ ownSection: 1, allSection: 0, ownCount: 1, allCount: 2, title: 'Общие указания' });
    expect(t[1]).toMatchObject({ number: '4', title: 'Правила', ownSection: 0, allSection: null });
    expect(t[1].items.map((i) => [i.origin, i.ownIndex])).toEqual([['own', 0], ['own', 1]]);
    expect(t[2].number).toBe('5');
  });

  it('пункт категории сверх числа общих — новый («own»), не «заменяет»', () => {
    const own = { sections: [{ key: 'service', title: 'Обслуживание', paragraphs: ['Свой осмотр', 'Ещё пункт'] }] };
    const s = textsTree(all, own).find((x) => x.key === 'service')!;
    expect(s.items.map((i) => i.origin)).toEqual(['override', 'own']);
  });

  it('пустой раздел категории (распорка) в дерево не попадает и порядок не меняет', () => {
    const own = { sections: [{ key: '_pad0', title: '', paragraphs: [] }, { key: 'extra', title: 'Доп', paragraphs: ['x'] }] };
    expect(textsTree(all, own).map((s) => s.key)).toEqual(['general', 'service', 'extra']);
  });

  it('на текстах v2 (TRN) порядок и номера совпадают со сборщиком', () => {
    const own = PASSPORT_TEXTS_V2.TRN, base = PASSPORT_TEXTS_V2.ALL;
    const t = textsTree(base, own);
    const blocks = [...legacyTemplateToBlocks(base), ...legacyTemplateToBlocks(own).map((b) => ({ ...b, category: 'TRN' }))];
    const c = compose(blocks, {}, 'TRN', { startNumber: legacyStartNumber(base) });
    expect(t.map((s) => [s.key, s.number, s.items.length])).toEqual(c.sections.map((s) => [s.key, s.number, s.items.length]));
    expect(t.flatMap((s) => s.items.map((i) => i.number))).toEqual(c.sections.flatMap((s) => s.items.map((i) => i.number)));
    expect(t.find((s) => s.key === 'general')!.items[0].origin).toBe('override');
    expect(t.find((s) => s.key === 'use')!.items.every((i) => i.origin === 'own')).toBe(true);
  });
});
