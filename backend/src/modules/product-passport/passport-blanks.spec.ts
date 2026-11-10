import { readFileSync } from 'fs';
import { join } from 'path';
import { blankItems, LABEL_SOURCES, printableText } from './passport-blanks';
import { buildV2Text } from './passport-v2-text';
import { hasLeak } from '../../common/print/fill-text';

const JSON_PATH = join(__dirname, '../../../scripts/passport-texts.v2.json');
const texts = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, { sections: Array<{ key: string; title: string; paragraphs: string[] }> }>;
const all = (texts.ALL ?? { sections: [] }) as never;

describe('паспорт: печать без «{…}»', () => {
  it('все метки из passport-texts.v2.json имеют источник', () => {
    const labels = new Set<string>();
    for (const m of readFileSync(JSON_PATH, 'utf8').matchAll(/\{([^{}"]+)\}/g)) labels.add(m[1]);
    const unknown = [...labels].filter((l) => !(l in LABEL_SOURCES) && !/^(std:|fig:|tab:)/.test(l));
    expect(unknown).toEqual([]);
  });

  it('шаблон с пустыми значениями → нет «{»/«не заполнено»; пустые фразы исчезли', () => {
    const t = buildV2Text({ passport: { passportCategory: 'TRN' }, all, own: { ...texts.TRN, version: 1 } as never });
    expect(t.missing.length).toBeGreaterThan(0);
    const p = printableText(t);
    const flat = p.sections.flatMap((s) => s.items.map((i) => i.text)).join('\n');
    expect(hasLeak(flat.replace(/{(fig|tab):[^}]+}/g, ''))).toBe(false); // {fig}/{tab} ставит PDF
    expect(flat).not.toMatch(/не заполнено|\[\{/);
    expect(flat).not.toMatch(/ростом не менее|Масса тела пользователя|Одновременно на тренажёре/); // пределы без значения не печатаются
    expect(flat).not.toMatch(/со дня передачи изделия покупателю/); // «мес.» не режет предложение (C064)
    expect(flat).not.toMatch(/,\s*,|\s{2,}|\s[.,]/);
    p.sections.forEach((s) => s.items.filter((i) => !i.bullet).forEach((i, n) => expect(i.number).toBe(`${s.number}.${n + 1}`)));
  });

  it('черновик: метки «не заполнено» остаются заметными', () => {
    const t = buildV2Text({ passport: { passportCategory: 'TRN' }, all, own: { ...texts.TRN, version: 1 } as never });
    const p = printableText(t, { draft: true, gaps: ['dimensions', 'images'] });
    const flat = [...p.sections.flatMap((s) => s.items.map((i) => i.text)), p.description ?? ''].join('\n');
    expect(flat).toMatch(/не заполнено/);
    expect(flat).toMatch(/Габариты и вес|Рисунки/);
  });

  it('«до {ageTo}» выпадает хвостом', () => {
    const t = { sections: [{ key: 's', number: '1', title: 'T', items: [{ key: 'p', number: '1.1', bullet: false, text: 'Для детей от 3 до [{ageTo} не заполнено] лет.' }] }] };
    expect(printableText(t).sections[0].items[0].text).toBe('Для детей от 3 лет.');
  });

  it('пункты «не хватает» для меток: подсказка — в изделии', () => {
    const [a, b] = blankItems(['maxUsers', 'std:GOST_X']);
    expect(a.hint).toContain('Карточка изделия');
    expect(b.key).toBe('std:GOST_X');
  });
});

describe('printableText: вариант и сертификат (ПТ-1, ПТ-2)', () => {
  const t = { sections: [
    { key: 'warranty', number: '4', title: 'Гарантия', items: [{ key: 'p1', number: '4.1', text: 'Текст.' }] },
    { key: 'storage', number: '5', title: 'Хранение', items: [{ key: 'p1', number: '5.1', text: 'Хранить сухо.' }] },
    { key: 'faults', number: '6', title: 'Неисправности', items: [{ key: 'p1', number: '6.1', text: 'Журнал.' }] },
  ] };
  it('хранение/неисправности печатаются в обоих вариантах', () => {
    expect(printableText(t, { variant: 'short' }).sections.map((s: { key?: string }) => s.key)).toEqual(['warranty', 'storage', 'faults']);
    expect(printableText(t, { variant: 'full' }).sections).toHaveLength(3);
  });
  it('сертификат: DIO — со ссылкой на ТР ЕАЭС 042, иначе без; пусто — строки нет', () => {
    const last = (o: Parameters<typeof printableText>[1]) => (printableText(t, { variant: 'full', ...o }).sections[0].items as Array<{ text: string }>).map((i) => i.text);
    expect(last({ certificate: { number: 'ЕАЭС N RU Д-RU.123' }, category: 'DIO' })).toContain('Сертификат/декларация соответствия ТР ЕАЭС 042/2017: ЕАЭС N RU Д-RU.123');
    expect(last({ certificate: { number: '77' }, category: 'WRK' })).toContain('Сертификат/декларация: 77');
    expect(last({ certificate: { number: ' ' }, category: 'DIO' })).toEqual(['Текст.']);
  });
});

describe('printableText: сплошная нумерация и ссылки на журналы сохраняются', () => {
  const t = { sections: [
    { key: 'warranty', number: '4', title: 'Гарантия', items: [{ key: 'p1', number: '4.1', text: 'А.' }] },
    { key: 'storage', number: '6', title: 'Хранение', items: [{ key: 'p1', number: '6.1', text: 'Б.' }] },
    { key: 'service', number: '7', title: 'ТО', items: [{ key: 'p1', number: '7.1', text: 'Осмотр. Записи — в таблицах 3 и 4 паспорта. Конец.' }] },
  ] };
  it('номера подряд, фраза про таблицы не вырезается', () => {
    const r = printableText(t, { variant: 'short' }).sections as Array<{ number: string; items: Array<{ number: string; text: string }> }>;
    expect(r.map((s) => s.number)).toEqual(['4', '5', '6']);
    expect(r[2].items[0]).toMatchObject({ number: '6.1', text: 'Осмотр. Записи — в таблицах 3 и 4 паспорта. Конец.' });
  });
});
