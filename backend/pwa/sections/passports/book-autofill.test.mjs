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
  passportParts: [{ value: 'frame', label: 'Каркас', cats: [] }, { value: 'post', label: 'Стойка', cats: ['TRN'] }, { value: 'seat', label: 'Сиденье', cats: ['BLG'] }],
};

function node(tag, props, ...children) {
  return { tag, props, children: children.flat(Infinity).filter(Boolean),
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, focus() {}, querySelector() {} };
}
const nodes = (el) => (el && typeof el === 'object' ? [el, ...el.children.flatMap(nodes)] : []);
const action = (el, label) => nodes(el).find((it) => it.tag === 'button' && it.props.label === label);
const field = (el, key) => nodes(el).find((it) => it.tag === 'form' && it.props.fields[0].key === key);
const viewText = (el) => (typeof el === 'string' ? el : el.children.flatMap(viewText).join(' '));

function scenario({ alternatives = [phrase, other], auto = false } = {}) {
  const writes = [];
  const slot = node('aside');
  const queue = node('aside');
  const readTemplate = () => structuredClone(stored);
  let stored = { mode: 'template', variant: 'short', passportCategory: 'TRN', productId: '1066', defaults: {}, document: {},
    readiness: { ready: false, missing: [desc] }, simpleDescriptionSource: null, simpleDescriptionSuggestions: [] };
  let work;
  const globals = {
    V2_NUMS: [], h: node, button: (opts) => node('button', opts), link: (opts) => node('a', opts, opts.label),
    hint: (message) => node('p', null, message), stack: (...children) => node('div', null, children),
    actions: (...children) => node('div', null, children), sidePanel: (title, ...children) => node('section', null, title, children),
    setSideWide() {}, busyBtn: () => () => {}, dictRows: async (key) => dict[key], dictOpts: async (key) => dict[key],
    attachCombo: (input, combo) => Object.assign(input.props, combo), textInput: (opts) => {
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
  const { mountBookFocus, openDescriptionSetup, openSimpleDescription } = vm.runInContext('({ mountBookFocus, openDescriptionSetup, openSimpleDescription })', context);
  const options = {
    isCurrent: () => true,
    save: async (change) => {
      writes.push(JSON.parse(JSON.stringify(change)));
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
      slot.replaceChildren(globals.button({ label: 'Своя формулировка', onClick: options.openOwn }));
      if (result?.saved && !stored.simpleDescriptionSource) open('simpleDescription');
    },
    openOwn: () => openSimpleDescription(slot, readTemplate(), options),
  };
  const open = (key) => {
    assert.equal(key, 'simpleDescription');
    work = openDescriptionSetup(slot, readTemplate(), options);
  };
  return { slot, queue, writes, readTemplate, open,
    loadQueue: () => mountBookFocus(queue, { S: { r: { ...stored.document, readiness: stored.readiness, productId: stored.productId }, template: readTemplate() }, can: true, openSetting: open }),
    wait: () => work,
  };
}

test('1066 без вида: из списка обязательного подбирает вид и фразу, при открытии удерживает результат', async () => {
  const s = scenario();
  s.loadQueue();
  action(s.queue, 'Краткое описание').props.onClick({});
  await s.wait();
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
  assert.match(viewText(s.slot), /Описание подставлено из справочника/);
  assert.equal(field(s.slot, 'kindId'), undefined);
  assert.equal(field(s.slot, 'simpleChoice'), undefined);
  assert.equal(field(s.slot, 'text'), undefined);
  await action(s.slot, 'Своя формулировка').props.onClick();
  assert.equal(field(s.slot, 'text').props.values.text, phrase.text);
  assert.ok(action(s.slot, 'Каркас ×'));
  assert.equal(action(s.slot, 'Стойка ×'), undefined);
  const search = nodes(s.slot).find((it) => it.tag === 'input' && it.props.label === 'Добавить часть');
  assert.ok(search);
  search.value = 'сто';
  assert.deepEqual([...search.props.options()].map((item) => item.value), ['post']);
  assert.equal(s.writes.length, 2);
});

test('готовый источник пропускает второй шаг, единственную неподтверждённую конструкцию можно подтвердить', async () => {
  for (const auto of [false, true]) {
    const s = scenario({ alternatives: [phrase], auto });
    s.open('simpleDescription');
    await s.wait();
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
  s.open('simpleDescription');
  await s.wait();
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
  assert.match(source, /label: 'Своя формулировка', size: 'S', onClick: openOwnDescription/);
  assert.match(source, /function openDescription\(\) \{ editTemplateSide\(openDescriptionSetup, true\); \}/);
  assert.match(source, /hideSimple\(followDescription\)/);
});
