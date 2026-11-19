import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const strip = (source) => source.replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
const node = (...children) => ({ children, hidden: false, addEventListener() {}, focus() {}, replaceChildren(...next) { this.children = next; } });
const kit = {
  h: (tag, props, ...children) => Object.assign(node(...children), { tag, ...props }),
  actions: (...children) => node(...children), stack: (...children) => node(...children), hint: (text) => text,
  button: (props) => ({ ...props }),
};
function setup(extra = {}) {
  const context = vm.createContext({ ...kit, bookKindLabel: () => '', ...extra });
  vm.runInContext(strip(read('./book-setup.js')) + '\nglobalThis.subject = { bookFacetModel, openBookFacets, purposeOptions, openBookPurpose, paintBookSetup, bookSettingOpener };', context);
  return context.subject;
}
const facets = [{ id: 'single', category: 'TRN', name: 'Вид', order: 2, step: true },
  { id: 'multi', category: 'TRN', name: 'Части', multi: true, step: false, order: 0 },
  { id: 'foreign', category: 'DIP' }, { id: 'gone', category: 'TRN', deletedAt: 'date' }];
const values = [{ id: 'a', parentId: 'single', name: 'A' }, { id: 'b', parentId: 'single', name: 'B' },
  { id: 'x', parentId: 'multi', name: 'X' }, { id: 'y', parentId: 'multi', name: 'Y' },
  { id: 'foreign-value', parentId: 'foreign' }, { id: 'dead', parentId: 'multi', deletedAt: 'date' }];
const plain = (value) => JSON.parse(JSON.stringify(value));

test('критерии: step=true сначала, родители/значения только живые и своей категории; defaults не baseline', () => {
  const model = setup().bookFacetModel({ passportCategory: 'TRN', defaults: { facetValueIds: ['a'] }, product: { facetValueIds: null } }, facets, values);
  assert.equal(model.baseline, null);
  assert.deepEqual(plain(model.rows.map((row) => row.id)), ['single', 'multi']);
  assert.deepEqual(plain(model.rows[1].choices.map((row) => row.id)), ['x', 'y']);
  assert.deepEqual(plain(model.rows[0].initial), []);
});

test('single/multi правка и повторное открытие сохраняют чужую категорию и нетронутые недоступные значения', () => {
  const template = { passportCategory: 'TRN', product: { facetValueIds: ['a', 'x', 'foreign-value', 'unknown'] } };
  const model = setup().bookFacetModel(template, facets, values);
  const changes = model.changes({ single: 'b', multi: ['x', 'y'] });
  assert.deepEqual(plain(changes.facetValueIds), ['foreign-value', 'unknown', 'b', 'x', 'y']);
  const reopened = setup().bookFacetModel({ ...template, product: changes }, facets, values);
  assert.deepEqual(plain(reopened.rows.map((row) => row.initial)), [['b'], ['x', 'y']]);
  assert.deepEqual(plain(reopened.changes({ single: '', multi: [] }).facetValueIds), ['foreign-value', 'unknown']);
});

test('форма критериев передаёт собственный null baseline в CAS, optional остаётся пустым', async () => {
  let state; let rendered; let initial; let request;
  const paths = [];
  const subject = setup({ api: async (path) => { paths.push(path); return { items: path.endsWith('productFacets') ? facets : path.endsWith('productFacetValues') ? values : [] }; },
    buildForm: (fields, values) => { rendered = fields; initial = values; return { el: node(), get: (key) => values[key], dirty: () => true, focus() {} }; },
    sideForm: (slot, options) => { state = options; },
  });
  await subject.openBookFacets(node(), { passportCategory: 'TRN', defaults: { kindId: 'k' }, product: { facetValueIds: null } },
    { isCurrent: () => true, done() {}, save: (...args) => { request = args; } });
  assert.equal(initial.single, ''); assert.equal(initial.multi, '[]');
  assert.equal(rendered.find((field) => field.key === 'single').required, undefined);
  assert.equal(rendered.some((field) => field.section && field.collapsed), true);
  assert.deepEqual(paths, ['/dicts/productFacets', '/dicts/productFacetValues', '/dicts/passportPhrases']);
  await state.save({ single: 'b', multi: [] });
  assert.deepEqual(plain(request), [{ facetValueIds: ['b'] }, { kindId: 'k', facetValueIds: null }]);
});

const constructionFacets = [
  { id: 'bike-form', code: 'blg.bikepark.form', name: 'Форма велопарковки', category: 'BLG', step: false },
  { id: 'nav-form', code: 'blg.canopy.form', name: 'Форма навеса', category: 'BLG', step: false },
  { id: 'generic', name: 'Общий признак', category: 'BLG', step: true },
];
const constructionValues = [
  { id: 'bike', name: 'Дуги', parentId: 'bike-form' },
  { id: 'nav', name: 'Балки', parentId: 'nav-form' },
  { id: 'old-bike', name: 'Прежняя форма другого вида', parentId: 'nav-form' },
  { id: 'generic-value', name: 'Общий', parentId: 'generic' },
  { id: 'foreign', name: 'Чужой', parentId: 'foreign-parent' },
];
const constructionPhrases = [
  { id: 'root-bike', section: 'simple-description', kindIds: ['bike-kind'], categories: 'BLG' },
  { id: 'root-nav', section: 'simple-description', kindIds: ['nav-kind'], categories: 'BLG' },
  { id: 'leaf-bike', parentId: 'root-bike', text: 'Велопарковка', facetValueIds: ['bike', 'old-bike'] },
  { id: 'leaf-nav', parentId: 'root-nav', text: 'Навес', facetValueIds: ['nav'] },
];
const navTemplate = { passportCategory: 'BLG', document: { kindId: 'nav-kind' }, product: { facetValueIds: [] } };

test('TRN bodyweight/contact доступны без фразы для выбранного kind, включая step=false contact', () => {
  const genericFacets = [
    { id: 'load', code: 'trn.load', category: 'TRN', step: true },
    { id: 'contact', code: 'trn.contact', category: 'TRN', step: false },
  ];
  const genericValues = [{ id: 'bodyweight', parentId: 'load' }, { id: 'two-platforms', parentId: 'contact' }];
  const phrases = [{ id: 'root', section: 'simple-description', kindIds: ['other-kind'] },
    { id: 'leaf', parentId: 'root', text: 'Другой тренажёр', facetValueIds: ['bodyweight', 'two-platforms'] }];
  const model = setup().bookFacetModel({ passportCategory: 'TRN', document: { kindId: 'cardio' }, product: { facetValueIds: null } }, genericFacets, genericValues, phrases);
  assert.deepEqual(plain(model.rows.map((row) => row.choices.map((value) => value.id))), [['bodyweight'], ['two-platforms']]);
});

test('строгий фильтр .form действует только при step=false и не выдаёт конструкцию чужому kind', () => {
  const subject = setup();
  const bikeFacet = constructionFacets.find((facet) => facet.id === 'bike-form');
  const strict = subject.bookFacetModel(navTemplate, [bikeFacet], constructionValues, constructionPhrases);
  assert.equal(strict.rows.length, 0);
  const primary = subject.bookFacetModel(navTemplate, [{ ...bikeFacet, step: true }], constructionValues, constructionPhrases);
  assert.deepEqual(plain(primary.rows[0].choices.map((value) => value.id)), ['bike']);
});

test('навес получает свою форму и generic, но не критерий велопарковки; kindIds наследуются от root', () => {
  const subject = setup();
  const model = subject.bookFacetModel(navTemplate, constructionFacets, constructionValues, constructionPhrases);
  assert.deepEqual(plain(model.rows.map((row) => row.id)), ['generic', 'nav-form']);
  assert.deepEqual(plain(model.rows[1].choices.map((value) => value.id)), ['nav']);
  const bikeModel = subject.bookFacetModel({ ...navTemplate, document: { kindId: 'bike-kind' } }, constructionFacets, constructionValues, constructionPhrases);
  assert.deepEqual(plain(bikeModel.rows.find((row) => row.id === 'bike-form').choices.map((value) => value.id)), ['bike']);
  assert.equal(subject.bookFacetModel({ ...navTemplate, document: {} }, constructionFacets, constructionValues, constructionPhrases).rows.length, 1);
});

test('смена скрывшегося single убирает старый id того же родителя; нетронутое/чужое остаётся', () => {
  const template = { ...navTemplate, product: { facetValueIds: ['old-bike', 'bike', 'foreign', 'unknown'] } };
  const model = setup().bookFacetModel(template, constructionFacets, constructionValues, constructionPhrases);
  const nav = model.rows.find((row) => row.id === 'nav-form');
  assert.deepEqual(plain(nav.initial), []);
  assert.deepEqual(plain(nav.hiddenSelected.map((value) => value.id)), ['old-bike']);
  assert.deepEqual(plain(model.changes({ 'nav-form': '', generic: '' }).facetValueIds), template.product.facetValueIds);
  assert.deepEqual(plain(model.changes({ 'nav-form': 'nav', generic: '' }).facetValueIds), ['bike', 'foreign', 'unknown', 'nav']);
});

test('неживой предок, цикл, битый parent и пересечение kindIds не превращают binding в generic', () => {
  const subject = setup();
  for (const extra of [
    [{ id: 'root-nav', section: 'simple-description', deletedAt: 'date' }],
    [{ id: 'root-nav', section: 'simple-description', parentId: 'cycle' }, { id: 'cycle', parentId: 'root-nav' }],
    [{ id: 'root-nav', section: 'simple-description', parentId: 'missing' }],
    [{ id: 'root-nav', section: 'simple-description', kindIds: ['bike-kind'] }],
  ]) {
    const phrases = [...extra, { id: 'leaf-nav', parentId: 'root-nav', kindIds: ['nav-kind'], text: 'Текст', facetValueIds: ['nav'] },
      { id: 'broken', parentId: 'missing', text: 'Битая ветка', facetValueIds: ['old-bike'] }];
    const model = subject.bookFacetModel(navTemplate, constructionFacets, constructionValues, phrases);
    assert.equal(model.rows.some((row) => row.id === 'nav-form'), false);
    assert.equal(model.rows.some((row) => row.id === 'generic'), true);
  }
});

test('ошибка третьего GET не открывает пустую успешную форму и не вызывает сохранение', async () => {
  let forms = 0; let saves = 0; let done = 0;
  const subject = setup({ api: async (path) => {
    if (path.endsWith('passportPhrases')) throw new Error('Справочник текстов недоступен');
    return { items: path.endsWith('productFacets') ? constructionFacets : constructionValues };
  }, buildForm: () => { forms++; }, sideForm: () => { forms++; } });
  await assert.rejects(subject.openBookFacets(node(), navTemplate,
    { isCurrent: () => true, save: () => saves++, done: () => done++ }), /Справочник текстов недоступен/);
  assert.equal(forms, 0); assert.equal(saves, 0); assert.equal(done, 0);
});

test('скрытый выбранный признак поясняется в форме без автоматического сохранения', async () => {
  let fields; let saves = 0;
  const subject = setup({ api: async (path) => ({ items: path.endsWith('productFacets') ? constructionFacets : path.endsWith('productFacetValues') ? constructionValues : constructionPhrases }),
    buildForm: (specs, initial) => { fields = specs; return { el: node(), get: (key) => initial[key], dirty: () => false, focus() {} }; }, sideForm() {} });
  await subject.openBookFacets(node(), { ...navTemplate, product: { facetValueIds: ['old-bike'] } },
    { isCurrent: () => true, save: () => saves++, done() {} });
  assert.match(fields.find((field) => field.note).note, /другому виду.*Прежняя форма другого вида/);
  assert.equal(saves, 0);
});

test('полное резюме критериев появляется initial и обновляется change для single и multi JSON/array', async () => {
  const listeners = {}; let formValues; let state;
  const full = 'Сиденье, рукоятки и педали с длинным полным описанием рабочих частей';
  const criterionValues = [{ id: 'a', name: full, parentId: 'single' }, { id: 'b', name: 'Полное другое значение', parentId: 'single' },
    { id: 'x', name: 'Первый полный вариант', parentId: 'multi' }, { id: 'y', name: 'Второй полный вариант', parentId: 'multi' }];
  const subject = setup({ api: async (path) => ({ items: path.endsWith('productFacets') ? facets : path.endsWith('productFacetValues') ? criterionValues : [] }),
    buildForm: (fields, initial) => {
      formValues = { ...initial };
      return { el: { addEventListener: (event, handler) => { listeners[event] = handler; } },
        get: (key) => formValues[key], dirty: () => false, focus() {} };
    }, sideForm: (slot, options) => { state = options; } });
  await subject.openBookFacets(node(), { passportCategory: 'TRN', document: {}, product: { facetValueIds: ['a', 'x', 'y'] } },
    { isCurrent: () => true, done() {}, save() {} });
  const summary = state.extra.children.find((child) => child?.['aria-label'] === 'Выбранные критерии полностью');
  assert.ok(summary); assert.equal(summary.hidden, false);
  const text = () => JSON.stringify(summary.children);
  assert.ok(text().includes(full)); assert.match(text(), /Вид/); assert.match(text(), /Части/);
  assert.match(text(), /Первый полный вариант/); assert.match(text(), /Второй полный вариант/);
  formValues.single = 'b'; formValues.multi = ['y']; listeners.change();
  assert.equal(text().includes(full), false); assert.match(text(), /Полное другое значение/);
  assert.doesNotMatch(text(), /Первый полный вариант/); assert.match(text(), /Второй полный вариант/);
  formValues.single = ''; formValues.multi = '[]'; listeners.change();
  assert.equal(summary.hidden, true); assert.deepEqual(plain(summary.children), []);
});

test('имя вида берётся из уже выполненного чтения формы выбора, setup не добавляет initial GET', async () => {
  let reads = 0;
  const context = vm.createContext({ ...kit, V2_NUMS: [],
    dictRows: async () => { reads++; return [{ id: 'nav-kind', name: 'Навес' }]; },
    buildForm: () => ({ el: node(), dirty: () => false, focus() {} }), ignoreSideForm() {} });
  vm.runInContext(strip(read('./book-template-edit.js'))
    + '\nsideForm = ignoreSideForm; globalThis.open = openBookSetting; globalThis.kindLabel = bookKindLabel;', context);
  assert.equal(context.kindLabel('nav-kind'), '');
  await context.open(node(), { defaults: {}, document: {}, passportCategory: 'BLG' },
    { key: 'kindId', isCurrent: () => true, save() {}, done() {} });
  assert.equal(context.kindLabel('nav-kind'), 'Навес');
  const host = node();
  setup({ bookKindLabel: context.kindLabel, V2_CATS: [] }).paintBookSetup(host,
    { ...navTemplate, variant: 'short' }, { can: true, open() {} });
  assert.match(JSON.stringify(host.children), /Вид изделия: Навес/);
  assert.equal(reads, 1);
});

test('назначение сначала ведёт на вид, full сохраняет прежнюю правку', () => {
  const calls = [];
  const S = { template: { variant: 'short', passportCategory: 'TRN' }, r: {} };
  const edit = setup({ openBookSetting: (...args) => calls.push(args.at(-1)), openBookCategory() {} })
    .bookSettingOpener(S, (open, options) => calls.push({ open, options }), () => {});
  edit('purpose');
  assert.equal(calls[0].options.followPurpose, true);
  calls[0].open(null, {}, {});
  assert.equal(calls[1].key, 'kindId');
  S.template.variant = 'full'; calls.length = 0;
  edit('purpose'); calls[0].open(null, {}, {});
  assert.equal(calls[1].key, 'purpose');
});

test('готовое назначение выбирается без textarea и отправляет точечный CAS baseline', async () => {
  let fields; let state; let query;
  const template = { productId: 'p', passportCategory: 'TRN', defaults: { textChoices: {}, manualPurpose: 'Свой', manualText: ['purpose', 'install'] }, document: {} };
  const result = [];
  const subject = setup({
    api: async (path, options) => { query = options.query; return { sections: [{ id: 'root', section: 'purpose', children: [{ id: 'leaf', name: 'Кардио', text: 'Готовый текст' }] }] }; },
    buildForm: (specs, initial) => { fields = specs; return { el: node(), get: (key) => initial[key], dirty: () => false, focus() {} }; },
    sideForm: (slot, options) => { state = options; },
  });
  await subject.openBookPurpose(node(), template, { isCurrent: () => true, done() {}, save: (...args) => result.push(args) });
  assert.deepEqual(plain(query), { category: 'TRN', productId: 'p', presentationVersion: 1, variant: 'short' });
  assert.equal(fields.some((field) => field.type === 'textarea'), false);
  await state.save({ purpose: 'leaf' });
  assert.deepEqual(plain(result[0][0]), { textChoices: { root: 'leaf' }, manualPurpose: null, manualText: ['install'] });
  assert.equal(result[0][1], template.defaults);
});

test('409 оставляет форму и ввод, отмена не сохраняет; readonly/full не показывают подготовку', async () => {
  const buttons = []; const slot = node(); let saves = 0; let done = 0;
  const context = vm.createContext({ ...kit, button: (props) => { const button = { ...props }; buttons.push(button); return button; },
    setSideWide() {}, sidePanel: (...children) => node(...children), busyBtn: () => () => {}, confirmDlg: async () => true });
  const source = read('./book-template-edit.js').match(/export function sideForm[\s\S]*?\n\}/)[0].replace('export ', '');
  vm.runInContext(source + '\nglobalThis.form = sideForm;', context);
  const input = { purpose: 'не терять' };
  context.form(slot, { title: 'Критерии', form: { el: node(), read: () => ({ values: input }) }, changed: () => true,
    save: async (values) => { saves++; assert.equal(values, input); throw new Error('409: шаблон изменился'); }, done: () => done++ });
  const children = slot.children;
  await buttons[0].onClick();
  assert.equal(done, 0); assert.equal(slot.children, children); assert.equal(input.purpose, 'не терять'); assert.equal(typeof slot._bkLeave, 'function');
  await buttons[1].onClick();
  assert.equal(saves, 1); assert.equal(done, 1);
  for (const [variant, can] of [['full', true], ['short', false]]) {
    const host = node(); setup().paintBookSetup(host, { variant }, { can });
    assert.equal(host.hidden, true); assert.equal(host.children.length, 0);
  }
});
