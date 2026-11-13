import { Types } from 'mongoose';
import { categoryFieldDefaults, gapKind, productGaps } from './passport-gaps';
import { buildV2Text } from './passport-v2-text';

describe('C070-П2: числа категории по умолчанию', () => {
  it('строки «ключ — значение», срок службы и гарантия; пустое и нули пропускаются', () => {
    expect(categoryFieldDefaults({ serviceLifeYears: '10', warrantyMonths: '12', fieldDefaults: 'heightMin — 1400\nweightMax - 120\r\nmaxUsers — 0\nбез значения\nsiteLength — 4,5' }))
      .toEqual({ heightMin: 1400, weightMax: 120, siteLength: 4.5, serviceLifeYears: 10, warrantyMonths: 12 });
    expect(categoryFieldDefaults(undefined)).toEqual({});
  });
});

const oid = () => new Types.ObjectId();
type Row = Record<string, unknown>;
const fv = [{ _id: oid(), dict: 'productFacets', code: 'trn.kind', name: 'Вид', category: 'TRN', order: 1, step: true, deletedAt: null }];
const kinds = [
  { _id: oid(), dict: 'productFacetValues', code: 'trn.kind.power', name: 'Силовой', parentId: fv[0]._id, order: 1, deletedAt: null },
  { _id: oid(), dict: 'productFacetValues', code: 'trn.kind.cardio', name: 'Кардио', parentId: fv[0]._id, order: 2, deletedAt: null },
];
const install = { _id: oid(), dict: 'passportInstall', code: 'EMBEDDED', name: 'Закладные', deletedAt: null };
const dictRows: Row[] = [...fv, ...kinds, install,
  { _id: oid(), dict: 'passportCategories', code: 'TRN', name: 'Уличный тренажёр', deletedAt: null }];

function fakeDb(product: Row | null, category: Row | null = null) {
  return {
    collection: (name: string) => ({
      findOne: async () => (name === 'products' ? product : name === 'categories' ? category : null),
      find: (q: Row) => ({ toArray: async () => (name === 'categories' ? (category ? [category] : []) : name === 'dict_values' ? dictRows.filter((r) => (q.deletedAt !== null || r.deletedAt === null) && (q.dict && typeof q.dict === 'object' ? ((q.dict as { $in: string[] }).$in).includes(r.dict as string) : r.dict === q.dict)) : []) }),
    }),
  } as never;
}
const checker = (missing: Array<{ label: string; key: string }>) => ({
  check: async () => ({ missing }),
  categoryRules: async () => new Map([['TRN', { name: 'Уличный тренажёр', serviceLifeYears: '10' }], ['ALL', { name: 'Для всех' }]]),
});

describe('«Чего не хватает» изделию (A3)', () => {
  it('вид пункта по ключу поля', () => {
    expect([gapKind('img_overview'), gapKind('installationTypeId'), gapKind('elements'), gapKind('weight')]).toEqual(['image', 'install', 'elements', 'field']);
  });
  it('нет категории — один пункт «категория» со списком вариантов, без «Для всех»', async () => {
    const r = await productGaps(checker([]), fakeDb({ _id: oid(), name: 'Станок' }), String(oid()));
    expect(r.category).toEqual({ code: null, name: null, source: null });
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toMatchObject({ kind: 'category', required: true, options: [{ id: 'TRN', label: 'Уличный тренажёр' }] });
  });
  it('признак без значения: обычный вопрос без подсказки; умолчания категории (установка, срок службы)', async () => {
    const prod = { _id: oid(), name: 'Жим ногами', passportDefaults: { passportCategory: 'TRN' } };
    const r = await productGaps(checker([{ label: 'Способ установки', key: 'installationTypeId' }, { label: 'Срок службы', key: 'serviceLifeYears' }, { label: 'Тексты', key: 'choice:1' }]), fakeDb(prod), String(prod._id));
    expect(r.category).toMatchObject({ code: 'TRN', source: 'own' });
    const kind = r.missing.find((m) => m.key === 'trn.kind')!;
    expect(kind).toMatchObject({ kind: 'facet' });
    expect('suggest' in kind).toBe(false);
    expect(kind.options).toHaveLength(2);
    expect(r.missing.find((m) => m.key === 'installationTypeId')).toMatchObject({ kind: 'install', required: true, default: { label: 'Закладные' } });
    expect(r.missing.find((m) => m.key === 'serviceLifeYears')).toMatchObject({ kind: 'field', default: 10 });
    expect(r.missing.some((m) => m.key.startsWith('choice:'))).toBe(false);
  });
  it('признак уже указан — не в списке', async () => {
    const prod = { _id: oid(), name: 'Жим', passportDefaults: { passportCategory: 'TRN' }, facetValueIds: [kinds[0]._id] };
    const r = await productGaps(checker([]), fakeDb(prod), String(prod._id));
    expect(r.missing).toEqual([]);
  });
});

describe('C086: применимость в «чего не хватает» (благоустройство)', () => {
  const f = (code: string, name: string, order: number) => ({ _id: oid(), dict: 'productFacets', code, name, category: 'BLG', order, step: true, deletedAt: null });
  const v = (facet: Row, name: string, words: string[] = []) => ({ _id: oid(), dict: 'productFacetValues', name, parentId: facet._id, order: 1, words, deletedAt: null });
  const fence = f('blg.fence', 'Элемент ограждения', 1), seats = f('blg.seats', 'Мест', 2), seat = f('blg.seat', 'Сиденье', 3), rail = f('blg.rail', 'Перила, спинка', 4), mat = f('blg.material', 'Материал', 5);
  const section = v(fence, 'Секция', ['секци']);
  const root = { _id: oid(), dict: 'passportPhrases', name: 'Назначение', section: 'purpose', deletedAt: null };
  const leaf = (name: string) => ({ _id: oid(), dict: 'passportPhrases', name, parentId: root._id, categories: 'BLG', text: name + '.', deletedAt: null });
  const info = leaf('Информирование'), guard = leaf('Ограждение'), rest = leaf('Отдых');
  const rows: Row[] = [fence, seats, seat, rail, mat, section, v(seats, '10'), v(seat, 'Доска'), v(rail, 'Без перил'), v(mat, 'Дерево', ['дерев']), root, info, guard, rest];
  const blg = { check: async () => ({ missing: [] }), categoryRules: async () => new Map([['BLG', { name: 'Благоустройство', requiredFields: 'serviceLifeYears' }]]) };
  const run = async (prod: Row) => { dictRows.push(...rows); try { return await productGaps(blg, fakeDb(prod), String(prod._id)); } finally { for (const r of rows) dictRows.splice(dictRows.indexOf(r), 1); } };
  const facetKeys = (r: { missing: Array<{ key: string; kind: string }> }) => r.missing.filter((m) => m.kind === 'facet').map((m) => m.key);
  const pd = (extra: Row = {}) => ({ passportCategory: 'BLG', ...extra });

  it('автоматическое назначение группы уже заполнено; чужая группа и битый ручной выбор не скрываются', async () => {
    const group = { _id: oid(), name: 'Информационные стенды и указатели', parentId: oid() };
    const bound = { ...leaf('Информирование — указатели и стенды'), groupIds: [String(group._id)] };
    dictRows.push(...rows, bound);
    try {
      const prod = { _id: oid(), name: 'Деревянные указатели', categoryId: group._id, passportDefaults: pd() };
      const result = await productGaps(blg, fakeDb(prod, group), String(prod._id));
      expect(result.missing.some((m) => m.kind === 'purpose')).toBe(false);
      const foreign = { ...prod, categoryId: oid() };
      expect((await productGaps(blg, fakeDb(foreign), String(prod._id))).missing.some((m) => m.kind === 'purpose')).toBe(true);
      const invalid = { ...prod, passportDefaults: pd({ textChoices: { [String(root._id)]: String(oid()) } }) };
      expect((await productGaps(blg, fakeDb(invalid, group), String(prod._id))).missing.find((m) => m.kind === 'purpose')?.required).toBe(true);
    } finally { for (const row of [...rows, bound]) dictRows.splice(dictRows.indexOf(row), 1); }
  });

  it('3905: группа указателей перекрывает старую спинку, сохраняет подсказку назначения', async () => {
    const oldRail = rows.find((r) => r.parentId === rail._id)!;
    const group = { _id: oid(), name: 'Информационные стенды и указатели', parentId: oid() };
    const prod = { _id: oid(), name: 'Арт объект Деревянные указатели', categoryId: group._id,
      facetValueIds: [oldRail._id], passportDefaults: pd() };
    dictRows.push(...rows);
    try {
      const r = await productGaps(blg, fakeDb(prod, group), String(prod._id));
      expect(r.applicable!.type).toMatchObject({ code: 'other', source: 'group' });
      expect(facetKeys(r)).toEqual(['blg.material']);
      expect(r.missing.some((m) => m.kind === 'purpose')).toBe(false);
      expect(prod.facetValueIds).toEqual([oldRail._id]);
    } finally { for (const row of rows) dictRows.splice(dictRows.indexOf(row), 1); }
  });

  it('указатель, назначение подтверждено: только материал; без ограждения, мест, сиденья и перил', async () => {
    const r = await run({ _id: oid(), name: 'Деревянные указатели 1100х1200 (смета)', passportDefaults: pd({ textChoices: { [String(root._id)]: String(info._id) } }) });
    expect(facetKeys(r)).toEqual(['blg.material']);
    expect(r.applicable).toMatchObject({ type: { code: 'other', source: 'purpose', known: true }, elements: 'optional', fields: { serviceLifeYears: 'required', warrantyMonths: 'optional' } });
    expect(Object.keys(r.applicable!.fields).some((k) => /^(maxUsers|age|height|weightMax|fallHeight|site)/.test(k))).toBe(false);
    expect(r.missing.some((m) => m.kind === 'purpose')).toBe(false);
  });
  it('указатель, назначение не выбрано: обычный вопрос со списком, без догадки по названию; тип ещё неизвестен', async () => {
    const r = await run({ _id: oid(), name: 'Деревянные указатели 1100х1200 (смета)', passportDefaults: pd() });
    expect(r.missing.filter((m) => m.kind === 'purpose')).toHaveLength(1);
    expect(r.missing.find((m) => m.kind === 'purpose')).toMatchObject({ required: false });
    expect('suggest' in r.missing.find((m) => m.kind === 'purpose')!).toBe(false);
    expect(r.applicable!.type).toMatchObject({ known: false, needed: true });
    expect(facetKeys(r)).toEqual(['blg.material']);
  });
  it('название ничего не говорит: одно уточнение назначения со списком вариантов категории, без догадки', async () => {
    const r = await run({ _id: oid(), name: 'Арт объект 2100х600', passportDefaults: pd() });
    const p = r.missing.filter((m) => m.kind === 'purpose');
    expect(p).toHaveLength(1);
    expect('suggest' in p[0]).toBe(false);
    expect(p[0].options!.map((o) => o.label)).toEqual(['Информирование', 'Ограждение', 'Отдых']);
    expect(facetKeys(r)).toEqual(['blg.material']);
  });
  it('ограждение: элемент ограждения остался, сиденья нет', async () => {
    const r = await run({ _id: oid(), name: 'Секция ограждения 2000х1200', passportDefaults: pd({ textChoices: { [String(root._id)]: String(guard._id) } }) });
    expect(facetKeys(r)).toEqual(['blg.fence', 'blg.material']);
    expect(r.missing.find((m) => m.key === 'blg.fence')!.options!.map((o) => o.label)).toEqual(['Секция']);
  });
  it('скамья: места, сиденье, перила; смена назначения пересчитывает состав', async () => {
    const prod = { _id: oid(), name: 'Шезлонг 3', passportDefaults: pd({ textChoices: { [String(root._id)]: String(rest._id) } }) };
    expect(facetKeys(await run(prod))).toEqual(['blg.seats', 'blg.seat', 'blg.rail', 'blg.material']);
    prod.passportDefaults = pd({ textChoices: { [String(root._id)]: String(info._id) } });
    expect(facetKeys(await run(prod))).toEqual(['blg.material']);
  });
  it.each(['чужая категория', 'удалённый вариант'])('сохранённое назначение: %s требует повторного выбора и не задаёт тип', async (reason) => {
    const foreign = { ...guard, _id: oid(), categories: 'DIO' };
    if (reason === 'чужая категория') rows.push(foreign);
    const selected = String(foreign._id);
    const prod = { _id: oid(), name: 'Изделие', passportDefaults: pd({ textChoices: { [String(root._id)]: selected } }) };
    try {
      const r = await run(prod);
      expect(r.applicable!.type.known).toBe(false);
      expect(r.missing.find((m) => m.kind === 'purpose')).toMatchObject({ required: true, label: expect.stringContaining('Выберите назначение заново') });
      expect(facetKeys(r)).toEqual(['blg.material']);
      expect((prod.passportDefaults as Row).textChoices).toEqual({ [String(root._id)]: selected });
    } finally { if (reason === 'чужая категория') rows.splice(rows.indexOf(foreign), 1); }
  });
  it('тип по группе каталога: уточнение назначения не требуется', async () => {
    dictRows.push(...rows);
    const prod = { _id: oid(), name: 'Изделие 5', categoryId: oid(), passportDefaults: pd() };
    const db = fakeDb(prod) as unknown as { collection: (n: string) => { findOne: () => Promise<unknown> } };
    const base = db.collection.bind(db);
    const fence = { _id: prod.categoryId, name: 'Ограждения', parentId: oid() };
    db.collection = (n: string) => (n === 'categories' ? { ...base(n), findOne: async () => fence, find: () => ({ toArray: async () => [fence] }) } : base(n));
    const r = await productGaps(blg, db as never, String(prod._id));
    for (const x of rows) dictRows.splice(dictRows.indexOf(x), 1);
    expect(r.applicable!.type).toMatchObject({ code: 'fence', source: 'group' });
    expect(r.missing.some((m) => m.kind === 'purpose')).toBe(false);
    expect(facetKeys(r)).toEqual(['blg.fence', 'blg.material']);
  });
  it('текст изделия ждёт число (качели: «пользователей одновременно») — поле применимо и обязательно, тупика нет', async () => {
    const swing = { ...blg, check: async () => ({ missing: [{ label: 'Пользователей одновременно', key: 'maxUsers' }] }) };
    dictRows.push(...rows);
    const prod = { _id: oid(), name: 'Качели 2 3000х1000х2000', passportDefaults: pd({ textChoices: { [String(root._id)]: String(rest._id) } }) };
    const r = await productGaps(swing, fakeDb(prod), String(prod._id));
    for (const x of rows) dictRows.splice(dictRows.indexOf(x), 1);
    expect(r.missing.find((m) => m.key === 'maxUsers')).toMatchObject({ kind: 'field', required: true });
    expect(r.applicable!.fields.maxUsers).toBe('required');
    expect('fallHeight' in r.applicable!.fields).toBe(false);
  });
  it('текстовое число остаётся доступным: пусто → заполнено → повторное открытие и правка', async () => {
    const prod = { _id: oid(), name: 'Качели', passportDefaults: pd() as Row };
    const render = (usedFields?: Set<string>) => buildV2Text({ passport: prod.passportDefaults, all: { sections: [{ key: 'usage', title: 'Правила', paragraphs: ['Не более {maxUsers} пользователей.'] }] }, usedFields });
    const svc = { ...blg,
      check: async (_body: Row, usedFields?: Set<string>) => ({ missing: render(usedFields).missing.map((key) => ({ key, label: key })) }),
    };
    const open = () => productGaps(svc, fakeDb(prod), String(prod._id));
    expect((await open()).missing.some((m) => m.key === 'maxUsers')).toBe(true);
    for (const value of [2, 2, 3]) {
      prod.passportDefaults.maxUsers = value;
      const r = await open();
      expect(r.missing.some((m) => m.key === 'maxUsers')).toBe(false);
      expect(r.applicable!.fields.maxUsers).toBe('required');
      expect(r.applicable!.fields.fallHeight).toBeUndefined();
    }
  });
  it('тренажёр: признаки и обязательные параметры пользователя на месте', async () => {
    const prod = { _id: oid(), name: 'Жим ногами', passportDefaults: { passportCategory: 'TRN' } };
    const r = await productGaps(checker([]), fakeDb(prod), String(prod._id));
    expect(facetKeys(r)).toEqual(['trn.kind']);
    expect(r.applicable).toMatchObject({ elements: 'required', type: { needed: false }, fields: { heightMin: 'required', weightMax: 'required', maxUsers: 'required', siteLength: 'required' } });
  });
});

describe('«Чего не хватает»: элементы (C028)', () => {
  const el = (name: string, categories: string, kind?: string) => ({ _id: oid(), dict: 'passportElements', name, categories, ...(kind ? { kind } : {}), deletedAt: null });
  const bar = el('Турник', 'TRN, WRK'), bush = el('Втулка', 'TRN', 'part'), free = el('Без категории', ''), other = el('Горка', 'DIO');
  const withEl = (extra: Row[]) => { dictRows.push(...extra); return () => { for (const r of extra) dictRows.splice(dictRows.indexOf(r), 1); }; };
  const miss = [{ label: 'Элементы', key: 'elements' }];

  it('список элементов: строго по категории, без деталей и без пустых категорий', async () => {
    const undo = withEl([bar, bush, free, other]);
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN' } };
    const r = await productGaps(checker(miss), fakeDb(prod), String(prod._id));
    undo();
    expect(r.missing.find((m) => m.key === 'elements')!.options!.map((o) => o.label)).toEqual(['Турник']);
  });
  it('элементы есть у изделия — строки нет', async () => {
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN', elements: [oid()] } };
    expect((await productGaps(checker(miss), fakeDb(prod), String(prod._id))).missing.some((m) => m.key === 'elements')).toBe(false);
  });
  it('нет вида: по названию не угадываем — один вопрос «Вид изделия» с видами категории, элементы спрашиваются как раньше', async () => {
    const hoop = { _id: oid(), dict: 'passportElements', name: 'Баскетбольная стойка', categories: 'WRK', kind: 'product', deletedAt: null };
    const wk = { _id: oid(), dict: 'passportKinds', name: 'Стойка', passportCategory: 'WRK', elementIds: [hoop._id], deletedAt: null };
    const other = { _id: oid(), dict: 'passportKinds', name: 'Скамья', passportCategory: 'BLG', deletedAt: null };
    const undo = withEl([hoop, wk, other]);
    const prod = { _id: oid(), name: 'Стойка баскетбольная', passportDefaults: { passportCategory: 'WRK' } };
    const r = await productGaps(checker(miss), fakeDb(prod), String(prod._id));
    undo();
    expect(r.kind).toBeNull();
    expect(r.missing[0]).toEqual({ key: 'kind', label: 'Вид изделия', kind: 'kind', required: true, options: [{ id: String(wk._id), label: 'Стойка' }] });
    expect(r.missing.find((m) => m.key === 'elements')).toBeDefined();
    expect('suggest' in r.missing.find((m) => m.key === 'elements')!).toBe(false);
  });
  describe('C100: вид изделия', () => {
    const el = { _id: oid(), dict: 'passportElements', name: 'Турник', categories: 'WRK', deletedAt: null };
    const root = { _id: oid(), dict: 'passportPhrases', name: 'Назначение', section: 'purpose', deletedAt: null };
    const leaf = { _id: oid(), dict: 'passportPhrases', name: 'Спорт', parentId: root._id, categories: 'WRK', text: 'Для спорта.', deletedAt: null };
    const gone = oid();
    const kind = (over: Row = {}) => ({ _id: oid(), dict: 'passportKinds', name: 'Турник', passportCategory: 'WRK', elementIds: [el._id], purposeLeafId: leaf._id, deletedAt: null, ...over });
    const group = (k: Row | null) => ({ _id: oid(), name: 'Турники', parentId: oid(), ...(k ? { passportKindId: k._id } : {}) });
    const run = async (prod: Row, rowsExtra: Row[], cat: Row | null) => {
      const rows = [el, root, leaf, ...rowsExtra]; dictRows.push(...rows);
      try { return await productGaps(checker(miss), fakeDb(prod, cat), String(prod._id)); } finally { for (const r of rows) dictRows.splice(dictRows.indexOf(r), 1); }
    };

    it('вид группы задан: нет вопросов элементов и назначения, категория из вида, источник — группа', async () => {
      const k = kind(), g = group(k);
      const r = await run({ _id: oid(), name: 'Турник 1', categoryId: g._id }, [k], g);
      expect(r.kind).toEqual({ id: String(k._id), name: 'Турник', source: 'group', groupName: 'Турники' });
      expect(r.category).toMatchObject({ code: 'WRK', source: 'kind' });
      expect(r.missing.some((m) => m.key === 'kind' || m.key === 'elements' || m.kind === 'purpose')).toBe(false);
    });
    it('своё главнее вида: свой вид изделия и свои элементы', async () => {
      const k = kind(), g = group(null);
      const own = await run({ _id: oid(), name: 'Х', categoryId: g._id, passportDefaults: { kindId: String(k._id) } }, [k], g);
      expect(own.kind).toMatchObject({ source: 'own' });
      const k2 = kind({ elementIds: [] }), g2 = group(k2);
      const withEl = await run({ _id: oid(), name: 'Х', categoryId: g2._id, passportDefaults: { elements: [oid()], textChoices: { [String(root._id)]: String(leaf._id) } } }, [k2], g2);
      expect(withEl.missing.some((m) => m.key === 'kind' || m.key === 'elements' || m.kind === 'purpose')).toBe(false);
    });
    it('удалённый вид — как будто вида нет: вопрос «Вид изделия»', async () => {
      const k = kind({ deletedAt: new Date() }), g = group(k);
      const r = await run({ _id: oid(), name: 'Х', categoryId: g._id, passportDefaults: { passportCategory: 'WRK' } }, [k], g);
      expect(r.kind).toBeNull();
      expect(r.missing.find((m) => m.key === 'kind')).toBeDefined();
    });
    it('назначение вида удалено — «Выберите назначение заново», молча не подменяется', async () => {
      const k = kind({ purposeLeafId: gone }), g = group(k);
      const r = await run({ _id: oid(), name: 'Х', categoryId: g._id }, [k], g);
      expect(r.missing.find((m) => m.kind === 'purpose')).toMatchObject({ required: true, label: expect.stringContaining('Выберите назначение заново') });
      expect(r.missing.some((m) => m.key === 'kind')).toBe(false);
    });
  });
  it('назначение уже выбрано — подсказки нет', async () => {
    const root = { _id: oid(), dict: 'passportPhrases', name: 'Назначение', section: 'purpose', deletedAt: null };
    const leaf = { _id: oid(), dict: 'passportPhrases', name: 'Баскетбол', parentId: root._id, categories: 'WRK', text: 'Для баскетбола.', deletedAt: null };
    const undo = withEl([root, leaf]);
    const prod = { _id: oid(), name: 'Стойка баскетбольная', passportDefaults: { passportCategory: 'WRK', textChoices: { [String(root._id)]: String(leaf._id) } } };
    const r = await productGaps(checker([]), fakeDb(prod), String(prod._id));
    undo();
    expect(r.missing.some((m) => m.kind === 'purpose')).toBe(false);
  });
  it('элементы приходят из признака — строки нет', async () => {
    const power = { ...kinds[0], elementIds: [oid()] };
    dictRows.push(power);
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN' }, facetValueIds: [power._id] };
    const r = await productGaps(checker(miss), fakeDb(prod), String(prod._id));
    dictRows.splice(dictRows.indexOf(power), 1);
    expect(r.missing.some((m) => m.key === 'elements')).toBe(false);
  });
});
