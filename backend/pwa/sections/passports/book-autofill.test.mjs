import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const desc = { key: 'simpleDescription', label: 'Краткое описание' };
const phrase = { id: 'leaf-1', rootId: 'root', name: 'Каркас', text: 'Изделие состоит из каркаса.', partIds: ['frame'] };
const other = { id: 'leaf-2', rootId: 'another-root', name: 'Стойка', text: 'Изделие состоит из стойки.', partIds: ['post'] };
const dict = {
  passportKinds: [{ id: 'kind', name: 'Тренажёр', passportCategory: 'TRN' }, { id: 'bench', name: 'Скамья', passportCategory: 'BLG' }],
  passportParts: [
    { id: 'frame', name: 'каркас', genSingular: ' каркаса ' },
    { id: 'post', name: 'стойка', genSingular: 'стойки', categories: 'TRN' },
    { id: 'seat', name: 'сиденье', genSingular: 'сиденья', categories: 'BLG' },
    { id: 'brake', name: ' ЭМ   тормоз ', genPlural: 'тормозов' },
    { id: 'alias', name: 'Эм тормоз' },
    { id: 'nameless', name: ' ', genSingular: 'рамы' },
  ],
};

function node(tag, props, ...children) {
  return { tag, props, children: children.flat(Infinity).filter(Boolean),
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items.flat(Infinity).filter(Boolean); }, focus() {}, querySelector() {} };
}
const nodes = (el) => (el && typeof el === 'object' && !el.hidden ? [el, ...el.children.flatMap(nodes)] : []);
const action = (el, label) => nodes(el).find((it) => it.tag === 'button' && it.props.label === label);
const field = (el, key) => nodes(el).find((it) => it.tag === 'form' && it.props.fields[0].key === key);
const viewText = (el) => typeof el === 'string' ? el : el.hidden ? '' : el.children.flatMap(viewText).join(' ');
const searchField = (el) => nodes(el).find((it) => it.tag === 'input' && it.props.label === 'Добавить часть');
const json = (value) => JSON.parse(JSON.stringify(value));
const click = (slot, label) => action(slot, label).props.onClick();

function scenario({ alternatives = [phrase, other], auto = false, defaults = {}, confirm = () => true, conflict = false } = {}) {
  const writes = [];
  const patches = [];
  const slot = node('aside');
  const queue = node('aside');
  const readTemplate = () => structuredClone(stored);
  const stored = { mode: 'template', variant: 'short', passportCategory: 'TRN', productId: '1066', defaults: structuredClone(defaults), document: {},
    readiness: { ready: false, missing: [desc] }, simpleDescriptionSource: null, simpleDescriptionSuggestions: [] };
  let work;
  const globals = {
    V2_NUMS: [], h: node, button: (opts) => node('button', opts), link: (opts) => node('a', opts, opts.label),
    hint: (message) => node('p', null, message), stack: (...children) => node('div', null, children),
    actions: (...children) => node('div', null, children), sidePanel: (title, ...children) => node('section', null, title, children),
    setSideWide() {}, busyBtn: () => () => {}, dictRows: async (key) => dict[key],
    api: async (path) => { assert.equal(path, '/dicts/passportParts'); return { items: dict.passportParts }; },
    confirmDlg: async (title) => confirm(title), codeList: (value) => value?.split(',') || [], catNames: () => '',
    attachCombo: (input, combo) => { Object.assign(input.props, combo); return { close() {} }; }, textInput: (opts) => {
      const input = node('input', opts);
      return { el: input, input, focus() {}, get value() { return input.value || ''; }, set value(value) { input.value = value; } };
    },
    buildForm(fields, initial = {}) {
      const values = { ...initial };
      return { el: node('form', { fields, values }), get: (key) => values[key], read: () => ({ values }), focus() {},
        dirty: () => JSON.stringify(values) !== JSON.stringify(initial) };
    },
  };
  const context = vm.createContext(globals);
  for (const file of ['./book-template.js', './book-choices.js', './book-template-edit.js', './book-focus.js']) {
    vm.runInContext(read(file).replace(/^import .+;\s*$/gm, '').replace(/export /g, ''), context);
  }
  const { mountBookFocus, openDescriptionSetup, openSimpleDescription, templatePatch, simplePartsPreview } = vm.runInContext(
    '({ mountBookFocus, openDescriptionSetup, openSimpleDescription, templatePatch, simplePartsPreview })', context,
  );
  const options = {
    isCurrent: () => true,
    save: async (change, baseline) => {
      patches.push(json(templatePatch(baseline, change)));
      if (conflict) throw Object.assign(new Error('Шаблон изменён другим пользователем.'), { status: 409 });
      writes.push(json(change));
      Object.assign(stored.defaults, change);
      if (change.kindId) {
        stored.document.kindId = change.kindId;
        stored.simpleDescriptionSuggestions = alternatives;
        if (!auto && alternatives.length) stored.readiness.missing = [{ key: `choice:${alternatives[0].rootId}`, label: 'Выберите описание' }];
      }
      const resolved = change.textChoices ? alternatives.find((item) => change.textChoices[item.rootId] === item.id) : auto ? alternatives[0] : null;
      if (resolved) {
        stored.simpleDescriptionSource = { kind: 'dictionary', id: resolved.id, rootId: resolved.rootId, partIds: resolved.partIds };
        stored.textSnapshot = { description: resolved.text };
        stored.readiness = { ready: true, missing: [] };
      }
    },
    done: (result) => {
      slot.replaceChildren(globals.button({ label: 'Краткое описание', onClick: options.openParts }));
      if (followDictionary && result?.saved && !stored.simpleDescriptionSource) work = options.openDictionary();
    },
    openParts() {
      followDictionary = false;
      return openSimpleDescription(slot, readTemplate(), options);
    },
    openDictionary() {
      followDictionary = true;
      return openDescriptionSetup(slot, readTemplate(), options);
    },
  };
  let followDictionary;
  const open = (key) => {
    assert.equal(key, 'simpleDescription');
    work = options.openParts();
  };
  return { slot, queue, writes, patches, readTemplate, open, simplePartsPreview, openDictionary: options.openDictionary,
    loadQueue: () => mountBookFocus(queue, { S: { r: { ...stored.document, readiness: stored.readiness, productId: stored.productId }, template: readTemplate() }, can: true, openSetting: open }),
    wait: () => work,
  };
}

test('1066 без вида: готовый вариант можно явно подобрать по виду, фраза и части предзаполнены при открытии', async () => {
  const s = scenario();
  s.loadQueue();
  action(s.queue, 'Краткое описание').props.onClick({});
  await s.wait();
  assert.ok(searchField(s.slot));
  assert.equal(field(s.slot, 'kindId'), undefined);
  await click(s.slot, 'Подобрать готовый вариант');
  assert.ok(field(s.slot, 'kindId'));
  assert.deepEqual([...field(s.slot, 'kindId').props.fields[0].options].map((item) => item.value), ['kind']);
  assert.equal(field(s.slot, 'text'), undefined);
  field(s.slot, 'kindId').props.values.kindId = 'kind';
  await action(s.slot, 'Сохранить в шаблон').props.onClick();
  assert.equal(field(s.slot, 'kindId'), undefined);
  assert.ok(field(s.slot, 'simpleChoice'));
  field(s.slot, 'simpleChoice').props.values.simpleChoice = phrase.id;
  await action(s.slot, 'Применить вариант').props.onClick();
  assert.deepEqual(s.writes, [{ kindId: 'kind' }, { textChoices: { root: 'leaf-1' } }]);
  assert.equal(s.readTemplate().readiness.ready, true);
  assert.equal(s.readTemplate().textSnapshot.description, phrase.text);
  s.open('simpleDescription');
  await s.wait();
  assert.match(viewText(s.slot), /Изделие состоит из каркаса\./);
  assert.equal(field(s.slot, 'kindId'), undefined);
  assert.equal(field(s.slot, 'simpleChoice'), undefined);
  assert.equal(field(s.slot, 'text'), undefined);
  await click(s.slot, 'Изменить текст');
  assert.equal(field(s.slot, 'text').props.values.text, phrase.text);
  assert.ok(action(s.slot, 'каркас ×'));
  assert.equal(action(s.slot, 'стойка ×'), undefined);
  const search = searchField(s.slot);
  assert.ok(search);
  search.value = 'сто';
  assert.ok([...search.props.options()].some((item) => item.value === 'post'));
  assert.equal(s.writes.length, 2);
});

test('готовый источник пропускает второй шаг, единственную неподтверждённую конструкцию можно подтвердить', async () => {
  for (const auto of [false, true]) {
    const s = scenario({ alternatives: [phrase], auto });
    await s.openDictionary();
    field(s.slot, 'kindId').props.values.kindId = 'kind';
    await action(s.slot, 'Сохранить в шаблон').props.onClick();
    assert.equal(field(s.slot, 'simpleChoice'), undefined);
    assert.equal(s.readTemplate().readiness.ready, auto);
    if (!auto) {
      assert.match(viewText(s.slot), /Подходит ли этот вариант/);
      await action(s.slot, 'Подтвердить вариант').props.onClick();
    }
    assert.equal(s.readTemplate().textSnapshot.description, phrase.text);
    assert.equal(s.writes.length, auto ? 1 : 2);
  }
});

test('если у известного вида словарной фразы нет, объясняет отсутствие и ведёт в словарь', async () => {
  const s = scenario({ alternatives: [] });
  await s.openDictionary();
  field(s.slot, 'kindId').props.values.kindId = 'kind';
  await action(s.slot, 'Сохранить в шаблон').props.onClick();
  assert.match(viewText(s.slot), /нет готового краткого описания/);
  assert.ok(nodes(s.slot).some((it) => it.props?.href === '#dicts?d=passportPhrases'));
  assert.equal(field(s.slot, 'text'), undefined);
  assert.equal(s.writes.length, 1);
});

test('вход редактора использует сценарий из очереди и оставляет собственный текст отдельным действием', () => {
  const source = read('./book-editor.js');
  assert.match(source, /key === 'simpleDescription' \? openDescription\(\) : editSetting\(key\)/);
  assert.match(source, /label: 'Краткое описание', size: 'S', onClick: openDescription/);
  assert.match(source, /function openDescription\(\) \{ editTemplateSide\(openSimpleDescription, \{ description: true \}\); \}/);
});

function pickPart(slot, id) {
  const search = searchField(slot);
  search.value = dict.passportParts.find((part) => part.id === id).name;
  const part = [...search.props.options()].find((item) => item.value === id);
  assert.ok(part);
  search.props.onPick(part);
}

test('авто: краткий список, живой текст по порядку, PATCH только выбранных id и повторное открытие', async () => {
  const s = scenario();
  s.open('simpleDescription');
  await s.wait();
  assert.deepEqual([...searchField(s.slot).props.options()].map((item) => item.value), ['post']);
  await click(s.slot, 'Сохранить в шаблон');
  assert.equal(s.patches.length, 0);
  pickPart(s.slot, 'frame');
  assert.match(viewText(s.slot), /Изделие состоит из каркаса\./);
  pickPart(s.slot, 'post');
  assert.match(viewText(s.slot), /Изделие состоит из каркаса и стойки\./);
  pickPart(s.slot, 'seat');
  assert.match(viewText(s.slot), /Изделие состоит из каркаса, стойки и сиденья\./);
  click(s.slot, 'каркас ×');
  pickPart(s.slot, 'frame');
  assert.match(viewText(s.slot), /Изделие состоит из стойки, сиденья и каркаса\./);
  await click(s.slot, 'Сохранить в шаблон');
  const value = { mode: 'parts', partIds: ['post', 'seat', 'frame'] };
  assert.deepEqual(s.patches, [{ expected: { simpleDescription: null }, changes: { simpleDescription: value } }]);
  s.open('simpleDescription');
  await s.wait();
  assert.match(viewText(s.slot), /Изделие состоит из стойки, сиденья и каркаса\./);
  assert.equal(field(s.slot, 'text'), undefined);
});

test('без genSingular весь перечень по name, дубли и пробелы убираются, регистр и аббревиатуры сохраняются', () => {
  const { simplePartsPreview } = scenario();
  const parts = new Map(dict.passportParts.map((part) => [part.id, part]));
  assert.equal(simplePartsPreview(['frame', 'brake', 'frame', 'alias', 'post'], parts),
    'Основные части изделия: каркас, ЭМ тормоз и стойка.');
  assert.equal(simplePartsPreview(['frame', 'missing'], parts), '');
  assert.equal(simplePartsPreview(['frame', 'nameless'], parts), '');
});

test('несуществующая часть видна, неполный автотекст нельзя сохранить, после удаления можно', async () => {
  const value = { mode: 'parts', partIds: ['frame', 'missing'] };
  const s = scenario({ defaults: { simpleDescription: value } });
  s.open('simpleDescription');
  await s.wait();
  assert.match(viewText(s.slot), /Уберите недоступные части/);
  assert.doesNotMatch(viewText(s.slot), /Изделие состоит из/);
  await click(s.slot, 'Сохранить в шаблон');
  assert.equal(s.patches.length, 0);
  click(s.slot, 'Часть недоступна (missing) ×');
  await click(s.slot, 'Сохранить в шаблон');
  assert.deepEqual(s.patches, [{ expected: { simpleDescription: value }, changes: { simpleDescription: { mode: 'parts', partIds: ['frame'] } } }]);
});

test('старая ручная фраза сохраняется как есть, набранный текст переживает смену режима и отмену подтверждения', async () => {
  const value = { text: 'Каркас и крепёж по чертежу.', partIds: ['frame'] };
  const s = scenario({ defaults: { simpleDescription: value }, confirm: (title) => title !== 'Сохранить без ручной правки?' });
  s.open('simpleDescription');
  await s.wait();
  assert.match(viewText(s.slot), /Каркас и крепёж по чертежу\./);
  await click(s.slot, 'Сохранить в шаблон');
  assert.equal(s.patches.length, 0);
  s.open('simpleDescription');
  await s.wait();
  click(s.slot, 'Изменить текст');
  const values = field(s.slot, 'text').props.values;
  assert.equal(values.text, value.text);
  values.text = 'Новая ручная фраза.';
  click(s.slot, 'Собрать из частей');
  pickPart(s.slot, 'post');
  assert.match(viewText(s.slot), /Изделие состоит из каркаса и стойки\./);
  await click(s.slot, 'Сохранить в шаблон');
  assert.equal(s.patches.length, 0);
  click(s.slot, 'Изменить текст');
  assert.equal(field(s.slot, 'text').props.values.text, values.text);
  await click(s.slot, 'Отмена');
  assert.equal(s.patches.length, 0);
});

test('409 сохраняет ручной ввод и исходную CAS пару', async () => {
  const value = { mode: 'parts', partIds: ['frame'] };
  const s = scenario({ defaults: { simpleDescription: value }, conflict: true });
  s.open('simpleDescription');
  await s.wait();
  click(s.slot, 'Изменить текст');
  assert.equal(field(s.slot, 'text').props.values.text, phrase.text);
  const text = 'Мой новый текст.';
  field(s.slot, 'text').props.values.text = text;
  pickPart(s.slot, 'post');
  assert.equal(field(s.slot, 'text').props.values.text, text);
  await click(s.slot, 'Сохранить в шаблон');
  assert.match(viewText(s.slot), /Шаблон изменён другим пользователем\./);
  assert.equal(field(s.slot, 'text').props.values.text, text);
  assert.deepEqual(s.patches, [{ expected: { simpleDescription: value }, changes: { simpleDescription: { text, partIds: ['frame', 'post'] } } }]);
  assert.deepEqual(s.readTemplate().defaults.simpleDescription, value);
});
