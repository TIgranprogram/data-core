import { readFileSync } from 'fs';
import { join } from 'path';
import { hasLeak } from '../../common/print/fill-text';
import { describeProduct } from './passport-compose-parts';
import { printableText } from './passport-blanks';
import { buildV2Text } from './passport-v2-text';
import { specRows } from './passport-pdf-v2-layout';
import { planFigures, substituteRefs } from './passport-pdf-v2-refs';
import { shortTiles } from './passport-pdf-v2-common';
import { compose, legacyTemplateToBlocks } from './passport-compose';

/**
 * C064: 5 плохих случаев пустых данных в паспорте PDF.
 * Выпуск — без «не заполнено»/undefined/{…}; пустые разделы и места под рисунки не печатаются.
 * Черновик — заметная пометка «не заполнено».
 */
const JSON_PATH = join(__dirname, '../../../scripts/passport-texts.v2.json');
const texts = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, { sections: Array<{ key: string; title: string; paragraphs: string[] }> }>;
const all = (texts.ALL ?? { sections: [] }) as never;

const flatOf = (t: { sections?: Array<{ items?: Array<{ text?: string }> }>; description?: string }) =>
  [...(t.sections ?? []).flatMap((s) => (s.items ?? []).map((i) => i.text ?? '')), t.description ?? ''].join('\n');

const clean = (s: string) => s.replace(/{(fig|tab):[^}]+}/g, '');

describe('C064: паспорт PDF — пропуски данных', () => {
  it('1) без веса и габаритов: выпуск — нет таблицы/плиток; черновик — «не заполнено»', () => {
    const empty = { status: 'issued' as const };
    expect(specRows(empty as never).filter(([, v]) => v != null && v !== '').length).toBe(0);
    expect(shortTiles(empty as never)).toEqual([]);
    const draft = printableText({ sections: [], description: '' }, { draft: true, gaps: ['dimensions'] });
    expect(flatOf(draft)).toMatch(/Габариты и вес: \[\{dimensions\} не заполнено\]/);
    expect(flatOf(printableText({ sections: [], description: '' }, { gaps: ['dimensions'] }))).not.toMatch(/не заполнено|Габариты/);
  });

  it('2) без возраста/роста: выпуск — фразы выпали; черновик — метки видны', () => {
    const raw = buildV2Text({ passport: { passportCategory: 'DIO', name: 'Горка' }, all, own: { ...texts.DIO, version: 1 } as never });
    expect(raw.missing).toEqual(expect.arrayContaining(['ageFrom', 'maxUsers']));
    const issued = printableText(raw);
    const issuedFlat = clean(flatOf(issued));
    expect(hasLeak(issuedFlat)).toBe(false);
    expect(issuedFlat).not.toMatch(/не заполнено|undefined|null|\[\{/);
    expect(issuedFlat).not.toMatch(/в возрасте от|ростом не менее|Одновременно оборудованием/i);
    const draft = printableText(raw, { draft: true });
    expect(flatOf(draft)).toMatch(/\[\{ageFrom\} не заполнено\]/);
    expect(flatOf(draft)).toMatch(/\[\{maxUsers\} не заполнено\]/);
  });

  it('3) без рисунков: нет приложений и пустых мест; ссылки выпадают; черновик — пометка', () => {
    const plan = planFigures(['Зона — {fig:safety_zone}, размеры — {fig:dimensions}.'], {});
    expect(plan.appendices).toEqual([]);
    expect(plan.inline.size).toBe(0);
    const cleared = substituteRefs('Зона — на {fig:safety_zone}, размеры — на {fig:dimensions}.', plan.fig, new Map());
    expect(cleared).not.toMatch(/\{/);
    expect(substituteRefs('Установить опоры (см. {fig:foundation}).', plan.fig, new Map())).toBe('Установить опоры.');
    const draft = printableText({ sections: [] }, { draft: true, gaps: ['images'] });
    expect(flatOf(draft)).toMatch(/Рисунки: \[\{images\} не заполнено\]/);
    expect(flatOf(printableText({ sections: [] }, { gaps: ['images'] }))).not.toMatch(/Рисунки|не заполнено/);
  });

  it('4) без материалов: выпуск — нет «изготовлено из …»; черновик — метка', () => {
    const desc = describeProduct({ name: 'Турник' }, [], []);
    expect(desc).toContain('[{materials} не заполнено]');
    const issued = printableText({ sections: [], description: desc });
    expect(issued.description).toBe('Турник (далее — изделие).');
    expect(issued.description).not.toMatch(/не заполнено|изготовлено из/i);
    const draft = printableText({ sections: [], description: desc }, { draft: true });
    expect(draft.description).toMatch(/\[\{materials\} не заполнено\]/);
  });

  it('5) без конструкции: условные пункты не печатаются; черновик — «не заполнено»', () => {
    const tpl = {
      sections: [{
        key: 'maint', title: '3 Обслуживание', paragraphs: ['Общий осмотр.', 'Проверить болтовые соединения.'],
        ids: ['p1', 'p2'], when: [null, 'bolts'],
      }],
    };
    const blocks = legacyTemplateToBlocks(tpl);
    const noJoints = compose(blocks, { traits: [] }, 'BLG', { unknownTraits: ['bolts', 'welds'] });
    expect(noJoints.needJoints).toBe(true);
    expect(noJoints.sections[0].items.map((i) => i.key)).toEqual(['p1']);
    const issued = printableText({ ...noJoints, description: '' });
    expect(flatOf(issued)).not.toMatch(/не заполнено|болтов/i);
    const draft = printableText({ ...noJoints, description: '' }, { draft: true });
    expect(flatOf(draft)).toMatch(/Конструкция.*\[\{joints\} не заполнено\]/);
  });
});
