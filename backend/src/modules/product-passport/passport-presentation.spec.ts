import { Types } from 'mongoose';
import { bindPresentation, lineScopeKey } from './passport-bind';
import { buildForest, forProduct, toNode } from '../../common/passport/phrase-tree';
import { renderSelectedParts } from '../../common/passport/simple-description';
import { renderSimplePhrase, selectSimpleDescription, simpleChoiceForest, simpleDescriptionSuggestions } from './passport-presentation';
import { buildV2Text } from './passport-v2-text';

describe('Источники версии 1 паспорта', () => {
  const productId = new Types.ObjectId(), salesOrderId = new Types.ObjectId(), incomeId = new Types.ObjectId();
  const supplierOrgId = new Types.ObjectId(), otherOrg = new Types.ObjectId();
  const order = { _id: salesOrderId, companyId: supplierOrgId, orderNo: 'Заказ-1', customer: 'Заказчик' };
  const position = { _id: incomeId, orderId: salesOrderId, productId, title: 'Имя по договору' };
  const firm = { _id: supplierOrgId, shortName: 'Наша фирма' };
  const hit = { products: { _id: productId }, incomes: position, salesorders: order, organizations: firm };
  const db = (override: Record<string, unknown> = {}) => ({
    collection: (name: keyof typeof hit) => ({ findOne: jest.fn(async () => Object.prototype.hasOwnProperty.call(override, name) ? override[name] : hit[name]) }),
  }) as never;

  it('использует позицию, заказ и фирму для полей и нормализует ключ позиции', async () => {
    expect(await bindPresentation(db(), { productId, salesOrderId, incomeId, orderNo: 'чужой', customerName: 'чужой' })).toMatchObject({
      productId, incomeId, salesOrderId, supplierOrgId, supplier: 'Наша фирма', orderNo: 'Заказ-1', customerName: 'Заказчик',
    });
    expect(await bindPresentation(db(), { productId, salesOrderId, incomeId, name: 'Своё имя экземпляра' })).not.toHaveProperty('name');
    expect(lineScopeKey(String(incomeId).toUpperCase())).toBe('line/' + String(incomeId));
  });

  it('отклоняет чужую фирму, связь и отменённую позицию', async () => {
    await expect(bindPresentation(db(), { productId, salesOrderId, incomeId, supplierOrgId: otherOrg })).rejects.toThrow('отличается от фирмы заказа');
    await expect(bindPresentation(db(), { productId, salesOrderId: otherOrg, incomeId })).rejects.toThrow('другому заказу');
    await expect(bindPresentation(db({ incomes: { ...position, cancelledAt: new Date() } }), { productId, salesOrderId, incomeId })).rejects.toThrow('отменена');
    await expect(bindPresentation(db({ organizations: null }), { productId, salesOrderId, incomeId })).rejects.toThrow('удалённая или чужая фирма');
  });
});

describe('C163: применимость соединений в short', () => {
  const passport = { passportCategory: 'TRN', presentationVersion: 1, variant: 'short' };
  const section = (key: string) => ({ key, title: key, paragraphs: ['Проверить болты {maxUsers}.'], when: ['bolts'] });
  it('технические разделы не требуют соединений или чисел; full сохраняет требования', () => {
    const all = { sections: ['description', 'materials', 'materials-spec', 'composition'].map(section), tables: [] };
    const short = buildV2Text({ passport, all });
    expect(short).toMatchObject({ needJoints: false, sections: [], missing: [] });
    expect(buildV2Text({ passport: { ...passport, variant: 'full' }, all }).needJoints).toBe(true);
  });
  it.each(['safety', 'installation', 'service'])('%s сохраняет необходимость подтверждённых соединений', (key) => {
    expect(buildV2Text({ passport, all: { sections: [section(key)] } }).needJoints).toBe(true);
  });
  it('условные дефекты обслуживания продолжают блокировать short', () => {
    expect(buildV2Text({ passport, all: { sections: [] },
      dicts: { defects: [{ code: 'THREAD', name: 'Ослабление болтов', when: 'bolts' }] } }).needJoints).toBe(true);
  });
});

describe('C161: краткая фраза из подтверждённых частей', () => {
  const parts = new Map([
    ['frame', { name: 'каркас', genSingular: ' каркаса ' }],
    ['handle', { name: 'рукоятка', genSingular: 'рукоятки' }],
    ['pedal', { name: 'педаль', genSingular: 'педали', genPlural: 'педалей' }],
    ['panel', { name: 'панель   ПВХ', genPlural: 'панелей ПВХ' }],
    ['panel-copy', { name: 'Панель ПВХ', genSingular: 'панели ПВХ' }],
    ['missing-name', { name: '  ', genSingular: 'детали' }],
  ]);

  it.each([
    [['frame'], 'Изделие состоит из каркаса.'],
    [['handle', 'pedal'], 'Изделие состоит из рукоятки и педали.'],
    [['pedal', 'frame', 'pedal', 'handle'], 'Изделие состоит из педали, каркаса и рукоятки.'],
    [['panel', 'panel-copy', 'pedal'], 'Основные части изделия: панель ПВХ и педаль.'],
    [[], ''],
  ])('сохраняет выбор и собирает фразу %#', (ids, text) => {
    expect(renderSelectedParts(ids, parts)).toEqual({ text, invalidPartIds: [] });
  });

  it('показывает каждую отсутствующую запись, не собирает частичный перечень', () => {
    expect(renderSelectedParts(['frame', 'removed', 'missing-name', 'removed'], parts))
      .toEqual({ text: '', invalidPartIds: ['removed', 'missing-name'] });
  });
});

describe('Снимок текста краткого паспорта', () => {
  const tree = buildForest([
    toNode({ id: 'simple', name: 'Краткое описание', section: 'simple-description' }),
    toNode({ id: 'suggestion', parentId: 'simple', name: 'Типовая фраза', text: 'Предложение из словаря.', allCategories: true }),
    toNode({ id: 'use', name: 'Безопасность', section: 'use' }),
    toNode({ id: 'rule', parentId: 'use', name: 'При повреждении', text: 'Не использовать при повреждении.', allCategories: true }),
  ], 'BLG');
  const base = {
    passportCategory: 'BLG', name: 'Изделие', materials: 'Стальные полосы', description: 'Полное техническое описание.',
    manualText: ['description'], simpleDescription: { text: 'Две опоры и настил.' },
  };
  const all = { sections: [], tables: [] };
  const build = (passport: Record<string, unknown>) => buildV2Text({ passport, all, own: null, funnel: { forest: tree } });

  it('печатает утверждённую краткую фразу и сохраняет инструкции', () => {
    const short = build({ ...base, presentationVersion: 1, variant: 'short' });
    expect(short.description).toBe('Две опоры и настил.');
    expect(short.sections.flatMap((s) => s.items.map((i) => i.text))).toContain('Не использовать при повреждении.');
    expect(build({ ...base, presentationVersion: 1, variant: 'short', simpleDescription: undefined }).description).toBe('');
  });

  it('сохраняет подробный текст в full и legacy, предложение отдела остаётся только предложением', () => {
    for (const p of [base, { ...base, presentationVersion: 1, variant: 'full' }]) {
      const text = build(p);
      expect(text.description).toBe('Полное техническое описание.');
      expect(text.sections.map((s) => s.key)).not.toContain('simple-description');
    }
    expect(simpleDescriptionSuggestions(tree)).toEqual([{ id: 'suggestion', rootId: 'simple', name: 'Типовая фраза', text: 'Предложение из словаря.', partIds: [] }]);
  });

  it('выбирает только один применимый вариант, отдаёт приоритет виду, учитывает ручной выбор', () => {
    const root = toNode({ id: 'root', name: 'Конструкция', section: 'simple-description' });
    const variant = (id: string, extra: object) => toNode({ id, parentId: 'root', name: id, text: 'Описание.', allCategories: true, ...extra });
    const variants = [
      variant('general', { isDefault: true }),
      variant('matched', { kindIds: ['kind'], facetValueIds: ['one'] }),
      variant('same', { kindIds: ['kind'], facetValueIds: ['two'] }),
    ];
    const select = (facets: string[], choices?: Record<string, string>) => selectSimpleDescription(forProduct(
      buildForest([root, ...variants], 'BLG'), { kindId: 'kind', facetValueIds: new Set(facets), groupIds: new Set() },
    ), choices)?.leaf.id ?? null;
    expect(select([])).toBe('general');
    expect(select(['one'])).toBe('matched');
    expect(select(['one', 'two'])).toBeNull();
    expect(select(['one', 'two'], { root: 'same' })).toBe('same');
    expect(select([], { root: 'same' })).toBeNull();
    expect(renderSimplePhrase('Изделие состоит из {parts}.', ['frame', 'seat'], new Map([
      ['frame', { genPlural: 'опор' }], ['seat', { genSingular: 'сиденья' }],
    ]))).toBe('Изделие состоит из опор и сиденья.');
    expect(renderSimplePhrase('Изделие состоит из {parts}.', ['missing'], new Map())).toBe('');
  });

  it('два неизвестных значения признака остаются вариантами выбора до ответа', () => {
    const root = toNode({ id: 'root', name: 'Схема', section: 'simple-description', kindIds: ['kind'] });
    const leaves = ['one', 'two'].map((id) => toNode({ id, parentId: 'root', name: id, text: 'Описание.', allCategories: true, facetValueIds: [id] }));
    const roots = buildForest([root, ...leaves], 'BLG');
    const context = { kindId: 'kind', facetValueIds: new Set<string>(), groupIds: new Set<string>() };
    const parents = new Map([['one', 'base'], ['two', 'base']]);
    expect(simpleDescriptionSuggestions(simpleChoiceForest(roots, context, parents)).map((r) => r.id)).toEqual(['one', 'two']);
    expect(selectSimpleDescription(forProduct(roots, context))).toBeNull();
    context.facetValueIds.add('two');
    expect(simpleDescriptionSuggestions(simpleChoiceForest(roots, context, parents)).map((r) => r.id)).toEqual(['two']);
    expect(selectSimpleDescription(forProduct(roots, context))?.leaf.id).toBe('two');
  });
});
