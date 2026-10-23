import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { maintenanceColumns, planFigures, renderPassportPdfV2, renderStandPdf, resolveStyle, shortTiles, standRules, substituteRefs, NEUTRAL_COLOR, type PdfV2Input, type PdfV2Text } from './passport-pdf-v2';

/** Образцы PDF для просмотра: PDFV2_OUT=<папка> npx jest passport-pdf-v2 */
const OUT = process.env.PDFV2_OUT;
const mediaBox = (b: Buffer) => (b.toString('latin1').match(/\/MediaBox \[([^\]]+)\]/) || [])[1]?.trim();
const count = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

const TEXT: PdfV2Text = {
  sections: [
    { key: 'safety', number: '3', title: 'Указания мер безопасности', items: [
      { key: 'p1', number: '3.1', bullet: false, text: 'Зона безопасности изделия показана на {fig:safety_zone}, размеры — на {fig:dimensions}.' },
      { key: 'p2', number: null, bullet: true, text: '— не пользоваться мокрым оборудованием;' },
      { key: 'p3', number: '3.2', bullet: false, text: 'Периодичность осмотров — {tab:to} (см. {fig:holes}).' },
    ] },
    { key: 'warranty', number: '4', title: 'Гарантии изготовителя', items: [{ key: 'p1', number: '4.1', bullet: false, text: 'Гарантийный срок — 12 месяцев со дня продажи.' }] },
  ],
  description: 'Детский игровой комплекс из стальных стоек и фанерных панелей.',
  purpose: 'Игры детей на открытых площадках.',
  rules: ['Подниматься только по лестнице', 'Не съезжать с горки головой вперёд'],
  maintenance: [
    { period: 'ежедневно', rows: [{ what: 'Целостность панелей', where: 'Панели', measure: 'Осмотр', tolerance: 'Без трещин' }] },
    { period: 'ежегодно', rows: [{ what: 'Затяжка крепежа', where: 'Узлы', measure: 'Ключ', tolerance: 'Без люфта' }] },
  ],
  install: { text: 'Разметить места опор\nЗабетонировать стойки', requirements: ['Ровная площадка'], requiredImages: [] },
};

const BASE: PdfV2Input = {
  passport: { passportNumber: '700', warrantyCode: '202610-700', productCode: 'ДИК-1', name: 'Комплекс игровой', height: 2500, length: 4000, width: 3000, weight: 350,
    warrantyMonths: 12, ageFrom: 3, ageTo: 12, maxUsers: 6, serviceLifeYears: 10, passportCategory: 'DIO', certificate: { hasEac: true },
    bom: [{ pos: 1, code: 'П-1', name: 'Панель', qty: 2, unit: 'шт.' }, { pos: 2, code: 'С-1', name: 'Стойка', qty: 4, unit: 'шт.' }] },
  org: { name: 'ООО «СпортИнЮг»', shortName: 'СпортИнЮг', inn: '2310181417', trademark: 'STREET IRON', directorName: 'Тен А.Т.' },
  text: TEXT,
  images: {},
  style: { color: '#2E7D32', categoryName: 'Детское игровое оборудование', icons: ['Перед занятием осмотрите оборудование', 'Не пользуйтесь мокрым оборудованием'] },
  withStamp: false,
  mode: 'pages',
};

describe('PDF паспорта v2 (БЗ-6 Э6)', () => {

  it('{fig}/{tab}: номер подставлен, отсутствующая ссылка выпадает без «дыр»', () => {
    const fig = new Map([['dimensions', [2, 3, 4]], ['safety_zone', [1]]]);
    const tab = new Map([['to', 5]]);
    expect(substituteRefs('Зона — на {fig:safety_zone}, размеры — {fig:dimensions}.', fig, tab)).toBe('Зона — на рис. 1, размеры — рис. 2–4.');
    expect(substituteRefs('Осмотры по {tab:to}.', fig, tab)).toBe('Осмотры по табл. 5.');
    expect(substituteRefs('Установить опоры (см. {fig:foundation}).', fig, tab)).toBe('Установить опоры.');
    expect(substituteRefs('Схема {fig:holes} и {tab:nope}', fig, tab)).toBe('Схема и');
    expect(substituteRefs('без ссылок', fig, tab)).toBe('без ссылок');
  });

  it('рисунки: приложения в порядке первой ссылки, без ссылки — в конце по видам; нумерация сквозная', async () => {
    const b = await png(10, 10, '#fff');
    const plan = planFigures(['см. {fig:foundation}', 'и {fig:dimensions}'], { dimensions: [{ buf: b }, { buf: b }], foundation: [{ buf: b }], overview_callouts: [{ buf: b }], overview: [{ buf: b }], bom_item: [{ buf: b, refCode: 'П-1' }] });
    expect(plan.appendices.map((a) => a.title)).toEqual(['Схемы установки опор', 'Габариты и зона безопасности', 'Общий вид и элементы изделия']);
    expect(plan.fig.get('foundation')).toEqual([1]);
    expect(plan.fig.get('dimensions')).toEqual([2, 3]);
    expect(plan.fig.get('overview_callouts')).toEqual([4]);
    expect(plan.fig.has('overview')).toBe(false);
    expect(plan.fig.has('bom_item')).toBe(false);
  });

  it('оформление: цвет категории или нейтральный, пиктограммы с {maxUsers}, «нет» — выключено', () => {
    const rows = [
      { kind: 'цвет категории', category: 'DIO', color: '#2E7D32', use: 'да' },
      { kind: 'пиктограмма правил', category: 'ALL', text: 'Не более {maxUsers} человек', use: 'да' },
      { kind: 'пиктограмма правил', category: 'ALL', text: 'Скрытое', use: 'нет' },
      { kind: 'пиктограмма правил', category: 'TRN', text: 'Чужая категория', use: 'да' },
    ];
    expect(resolveStyle(rows, 'DIO', { maxUsers: 4 })).toEqual({ color: '#2E7D32', icons: ['Не более 4 человек'] });
    expect(resolveStyle(rows, 'MAF', {})).toEqual({ color: NEUTRAL_COLOR, icons: [] });
    expect(shortTiles({ ageFrom: 3, ageTo: 12, serviceLifeYears: 2, warrantyMonths: 12 }).map((t) => t.value)).toEqual(['3–12 лет', '2 года', '12 мес.']);
  });

  it('собирается в обоих режимах (без картинок и с картинкой); print = ceil(pages/4)*2; пустые блоки не дают страниц', async () => {
    const pages = await renderPassportPdfV2(BASE);
    const print = await renderPassportPdfV2({ ...BASE, mode: 'print' });
    expect(pages.subarray(0, 5).toString()).toBe('%PDF-');
    expect(count(print)).toBe(Math.ceil(count(pages) / 4) * 2);

    const img = await png(800, 500, '#90caf9');
    const withImg: PdfV2Input = { ...BASE, images: { overview: [{ buf: img }], foundation: [{ buf: img, caption: 'Разрез опоры' }], bom_item: [{ buf: img, refCode: 'П-1' }] }, logo: await png(300, 100, '#ffcc80') };
    const p2 = await renderPassportPdfV2(withImg);
    const pr2 = await renderPassportPdfV2({ ...withImg, mode: 'print' });
    expect(count(p2)).toBe(count(pages) + 1); // рисунок без ссылки — одно приложение «Схемы установки опор», одна страница
    expect(count(pr2)).toBe(Math.ceil(count(p2) / 4) * 2);

    // пусто: ни «Коротко», ни ТО, ни монтажа, ни описания — только раздел, комплектность, обложка и талон
    const bare = await renderPassportPdfV2({ ...BASE, passport: { passportNumber: '1', name: 'Урна' }, style: {},
      text: { sections: [{ key: 'w', number: '3', title: 'Гарантии', items: [{ key: 'p1', number: '3.1', bullet: false, text: 'Срок — 12 месяцев.' }] }] } });
    expect(count(bare)).toBe(3);
    const withNote = await renderPassportPdfV2({ ...BASE, passport: { ...BASE.passport, note: 'Проверить крепёж' } });
    expect(count(withNote)).toBe(count(pages) + 1);

    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'passport-v2-A5.pdf'), p2);
      writeFileSync(join(OUT, 'passport-v2-print-A4.pdf'), pr2);
    }
  });

  it('рисунок со ссылкой в абзаце — «по месту», номер первым, в приложения не попадает; без ссылки — в приложении', async () => {
    const b = await png(10, 10, '#fff');
    const imgs = { dimensions: [{ buf: b }, { buf: b }], safety_zone: [{ buf: b }], foundation: [{ buf: b }] };
    const plan = planFigures(['Размеры — {fig:dimensions}', 'см. {fig:foundation}'], imgs, ['Размеры — {fig:dimensions}']);
    expect([...plan.inline.keys()]).toEqual(['dimensions']);
    expect(plan.fig.get('dimensions')).toEqual([1, 2]);
    expect(plan.inline.get('dimensions')?.[0].caption).toBe('Рисунок 1 — Габаритные размеры');
    const inApp = plan.appendices.flatMap((a) => a.figs.map((f) => f.kind));
    expect(inApp).not.toContain('dimensions');
    expect(inApp).toEqual(['foundation', 'safety_zone']); // foundation — по ссылке в таблице, safety_zone — без ссылки
    expect(plan.fig.get('foundation')).toEqual([3]);
  });

  it('PDF с рисунками «по месту» собирается; приложения на них не появляется', async () => {
    const img = await png(800, 500, '#90caf9');
    const plain = await renderPassportPdfV2(BASE);
    const inl = await renderPassportPdfV2({ ...BASE, images: { dimensions: [{ buf: img }], safety_zone: [{ buf: img }] } });
    expect(inl.subarray(0, 5).toString()).toBe('%PDF-');
    expect(count(inl)).toBeGreaterThanOrEqual(count(plain));
    expect(count(inl)).toBeLessThanOrEqual(count(plain) + 1); // два рисунка в тексте, а не две страницы приложений
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'passport-v2-inline-figs.pdf'), inl); }
  });

  it('таблица ТО: колонка «Вид» — только если картинка есть хотя бы у одной строки', async () => {
    const pic = await png(60, 60, '#e57373');
    expect(maintenanceColumns([{ photoId: 'a' }, {}], {}).withImg).toBe(false);
    expect(maintenanceColumns([{}, {}], { a: pic }).cols).not.toContain('Вид');
    const on = maintenanceColumns([{ photoId: 'x' }, { photoId: 'a' }], { a: pic });
    expect(on.withImg).toBe(true);
    expect(on.cols).toContain('Вид');
    expect(on.widths).toHaveLength(on.cols.length);
    const text: PdfV2Text = { ...TEXT, maintenance: [{ period: 'ежемесячно', rows: [{ what: 'Коррозия', where: 'Стойки', measure: 'Зачистить', tolerance: 'Нет', photoId: 'a' }, { what: 'Крепёж', where: 'Узлы', measure: '', tolerance: '' }] }] };
    const buf = await renderPassportPdfV2({ ...BASE, text, defectImages: { a: pic } });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('лист для стенда: одна страница A3 книжная, даже при длинном списке правил', async () => {
    expect(standRules(['Не более 4 человек', 'Не бегать'], ['— не бегать;', 'Держитесь за поручни'], 4)).toEqual(['Не бегать', 'Держитесь за поручни']);
    const stand = await renderStandPdf({ passport: BASE.passport, org: { ...BASE.org, phone: '+7 (861) 000-00-00', email: 'info@example.ru' }, text: TEXT, style: BASE.style, logo: await png(300, 100, '#ffcc80') });
    expect(count(stand)).toBe(1);
    expect(mediaBox(stand)).toBe('0 0 841.89 1190.55');
    const many = Array.from({ length: 40 }, (_, i) => `Правило номер ${i + 1}: длинный текст правила пользования оборудованием на площадке`);
    expect(count(await renderStandPdf({ passport: { name: 'Урна' }, org: null, text: { rules: many }, style: {} }))).toBe(1);
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'passport-v2-stand-A3.pdf'), stand); }
  });
});
