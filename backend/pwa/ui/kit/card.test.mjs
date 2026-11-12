import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

class Text {
  constructor(value) { this.textContent = String(value); }
}

// В DOM обработчики addEventListener и свойство onclick существуют независимо.
class Element {
  constructor(tag) {
    this.localName = tag;
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.hidden = false;
    this.disabled = false;
    this.onclick = null;
  }
  addEventListener(type, fn) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(fn);
    this.listeners.set(type, listeners);
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  closest() { return this; }
  focus() { this.focused = true; }
  querySelectorAll() { return []; }
  setAttribute() {}
  removeAttribute() {}
  append(...children) { for (const c of children) { const node = c instanceof Element || c instanceof Text ? c : new Text(c); node.parent = this; this.children.push(node); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get firstChild() { return this.children[0]; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(text) { this.replaceChildren(text); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      if (child instanceof Element) {
        const found = child.find(predicate);
        if (found) return found;
      }
    }
  }
  async click() {
    if (this.disabled) return;
    const event = { currentTarget: this, preventDefault() {} };
    const handlers = [...(this.listeners.get('click') || []), this.onclick].filter(Boolean);
    // Браузер вызывает оба обработчика синхронно, даже если первый вернул Promise.
    await Promise.all(handlers.map((fn) => fn.call(this, event)));
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture({ pending = true, commit, solo = false, viewed } = {}) {
  const body = new Element('body');
  const reports = [];
  let windowCloses = 0, geometryCalls = 0;
  const document = {
    body, createElement: (tag) => new Element(tag), createTextNode: (text) => new Text(text),
    querySelector: (selector) => body.find((el) => selector === '.toasts' && el.className === 'toasts'),
    addEventListener() {}, removeEventListener() {},
  };
  const context = createContext({
    document, Element, DocumentFragment: class {}, Node: class {
      static [Symbol.hasInstance](node) { return node instanceof Element || node instanceof Text; }
    },
    window: { innerWidth: 390, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, close() { windowCloses++; } }, CustomEvent: class {}, setTimeout: () => 0,
  });
  const noop = () => {};
  const deps = {
    './garbage.js': { scrubText: (text) => text },
    '../../core/api.js': { api: noop, canEditSection: () => true, PREFIX: '', session: {} },
    '../../core/errors.js': { reportError: (error, meta) => reports.push({ error, action: meta.action }) },
    './mark.js': { mark: (el) => el },
    './readonly.js': { readonlyGroups: () => null },
    '../../core/router.js': { go: noop },
    '../../core/format.js': { dateTime: noop },
    '../history.js': { actionLabel: noop, changeList: noop, usefulEntry: noop },
    './dialog.js': { confirmDlg: () => assert.fail('Шаблон не должен спрашивать об отмене изменений') },
    '../confirm-password.js': { withConfirm: noop },
    './photos.js': { photoDrop: noop },
    './form.js': { buildForm: noop },
    './errors.js': { actionText: () => 'Не удалось сохранить', errText: noop, isFailure: () => true },
    './busy.js': { busyBlock: noop, busyBtn: () => noop, failBlock: noop },
    './card-tabs.js': { buildCardTabs: noop },
    '../resizer.js': { makeResizable: noop },
    '../../core/prefs.js': { DOCK_MIN: 1000, getPref: noop, setPref: noop },
    '../../core/popout.js': { isSolo: () => solo, popout: noop, setPopout: noop, soloGeometry: () => { geometryCalls++; } },
    '../notice-card.js': { noticeCard: ({ title }) => new Text(title), splitReason: (title) => ({ title }) },
    '../notices.js': { addNotice: noop },
  };
  const sources = new Map(Object.entries({
    './card.js': './card.js', './card-parent.js': './card-parent.js', './toast.js': './toast.js', '../../core/dom.js': '../../core/dom.js',
  }).map(([key, url]) => [key, new SourceTextModule(readFileSync(new URL(url, import.meta.url), 'utf8'), { context })]));
  const mocks = new Map();
  const module = sources.get('./card.js');
  await module.link((key) => {
    if (sources.has(key)) return sources.get(key);
    if (!mocks.has(key)) {
      const values = deps[key];
      assert.ok(values, `Неожиданный импорт ${key}`);
      mocks.set(key, new SyntheticModule(Object.keys(values), function () {
        for (const [name, value] of Object.entries(values)) this.setExport(name, value);
      }, { context }));
    }
    return mocks.get(key);
  });
  await module.evaluate();

  const calls = { view: 0, beforeClose: 0, commit: 0 };
  const edit = new Element('form');
  const card = module.namespace.openCard({
    title: 'Шаблон паспорта',
    get: async () => ({ id: '3905', name: 'Указатель' }),
    card: { startEdit: () => true, heading: (row) => row.name, noHistory: true, view: () => { calls.view++; return []; } },
    form: { build: () => ({
      el: edit, readonly: true, doneLabel: 'Готово', dirty: () => false,
      beforeClose: async () => {
        calls.beforeClose++;
        if (pending) { calls.commit++; await commit?.(); pending = false; }
      },
    }) },
  }, { id: '3905' }, { close: () => assert.fail('Должен открыться просмотр карточки'), changed: noop, viewed });
  await tick();
  const done = body.find((el) => el.localName === 'button' && el.textContent === 'Готово');
  assert.ok(done);
  assert.equal(card.editing, true);
  assert.equal(calls.view, 1);
  return { card, calls, done, reports, body, edit, document, openCard: module.namespace.openCard, get windowCloses() { return windowCloses; }, get geometryCalls() { return geometryCalls; } };
}

test('Готово ждёт запись и переключает просмотр после одного коммита', async () => {
  const write = Promise.withResolvers();
  const { card, calls, done, reports } = await fixture({ commit: () => write.promise });
  const finished = done.click();
  await tick();
  assert.equal(card.editing, true);
  assert.equal(done.disabled, true);
  await done.click();
  assert.deepEqual(calls, { view: 1, beforeClose: 1, commit: 1 });
  write.resolve();
  await finished;
  assert.equal(card.editing, false);
  assert.deepEqual(calls, { view: 2, beforeClose: 1, commit: 1 });
  assert.deepEqual(reports, []);
});

test('сбой записи оставляет форму, показывает ошибку и разрешает повторить', async () => {
  const error = new TypeError('Сбой записи');
  let attempt = 0;
  const { card, calls, done, reports, body, edit } = await fixture({ commit: () => {
    if (++attempt === 1) throw error;
  } });
  await done.click();
  assert.equal(card.editing, true);
  assert.equal(done.disabled, false);
  assert.equal(body.find((el) => el === edit), edit);
  assert.match(body.textContent, /Не удалось сохранить/);
  assert.deepEqual(calls, { view: 1, beforeClose: 1, commit: 1 });
  assert.deepEqual(reports, [{ error, action: 'сохранить' }]);
  await done.click();
  assert.equal(card.editing, false);
  assert.deepEqual(calls, { view: 2, beforeClose: 2, commit: 2 });
  assert.equal(reports.length, 1);
});

test('Готово без изменений открывает просмотр без коммита и ошибки', async () => {
  const { card, calls, done, reports } = await fixture({ pending: false });
  await done.click();
  assert.equal(card.editing, false);
  assert.deepEqual(calls, { view: 2, beforeClose: 1, commit: 0 });
  assert.deepEqual(reports, []);
});


test('дочерняя панель сохраняет DOM, фокус, прокрутку и снимает inert при возврате', async () => {
  const { card, body, edit, document, openCard } = await fixture();
  const parent = body.find((el) => el.localName === 'aside');
  const scroller = parent.find((el) => el.className === 'drawer-body');
  scroller.scrollTop = 317;
  edit.isConnected = true; document.activeElement = edit;
  const child = openCard({ title: 'Элемент', card: {}, form: { build: () => ({ el: new Element('div'), readonly: true, dirty: () => false }) } },
    { mode: 'create', parent }, { close() {}, changed() {} });
  await tick();
  assert.equal(parent.hidden, true); assert.equal(parent.inert, true);
  assert.equal(card.isDirty(), true);
  assert.equal(body.find((el) => el === edit), edit);
  child.close();
  assert.equal(parent.hidden, false); assert.equal(parent.inert, undefined);
  assert.equal(scroller.scrollTop, 317); assert.equal(edit.focused, true);
  assert.equal(card.isDirty(), false);
  assert.equal(body.children.filter((el) => el.localName === 'aside').length, 1);
});

test('уничтожение родителя удаляет дочернюю панель', async () => {
  const { card, body, openCard } = await fixture();
  const parent = body.find((el) => el.localName === 'aside');
  openCard({ title: 'Элемент', card: {}, form: { build: () => ({ el: new Element('div'), readonly: true, dirty: () => false }) } },
    { mode: 'create', parent }, { close() {}, changed() {} });
  await tick();
  card.close();
  assert.equal(body.children.filter((el) => el.localName === 'aside').length, 0);
});


test('ошибка дочерней записи сохраняет многострочный ввод, повтор возвращает к родителю', async () => {
  const { body, openCard } = await fixture();
  const parent = body.find((el) => el.localName === 'aside');
  const entry = new Element('textarea'); entry.value = 'Первая строка\nВторая строка';
  let attempts = 0, closed = 0;
  openCard({ title: 'Элемент', card: {}, form: {
    build: () => ({ el: entry, dirty: () => false, read: () => ({ values: { rules: entry.value } }) }),
    toBody: (v) => v, closeAfterCreate: true,
    create: async (values) => { assert.equal(values.rules, entry.value); if (++attempts === 1) throw new Error('Сбой'); return { id: 'created' }; },
  } }, { mode: 'create', parent }, { close() { closed++; }, changed() {} });
  await tick();
  const save = body.find((el) => el.localName === 'button' && el.textContent === 'Создать');
  await save.click();
  assert.equal(body.find((el) => el === entry), entry);
  assert.equal(entry.value, 'Первая строка\nВторая строка');
  assert.equal(closed, 0); assert.equal(parent.inert, true);
  await save.click();
  assert.equal(closed, 1); assert.equal(parent.hidden, false);
  assert.equal(body.children.filter((el) => el.localName === 'aside').length, 1);
});


test('дочерняя панель в отдельном окне не наследует solo и не закрывает окно', async () => {
  const f = await fixture({ solo: true });
  const parent = f.body.find((el) => el.localName === 'aside');
  f.openCard({ title: 'Элемент', card: {}, form: { build: () => ({ el: new Element('div'), readonly: true, dirty: () => false }) } },
    { mode: 'create', parent }, { close() {}, changed() {} });
  await tick();
  assert.equal(f.geometryCalls, 1);
  const child = f.body.children.filter((el) => el.localName === 'aside')[1];
  await child.find((el) => el.localName === 'button' && el.textContent === '✕').click();
  assert.equal(f.windowCloses, 0);
  assert.equal(parent.hidden, false);
});

test("Успешный просмотр сообщает карточку для истории", async () => {
 const seen=[]; await fixture({viewed:(row,title,kind)=>seen.push({id:row.id,title,kind})});
 assert.equal(seen.length,1); assert.equal(seen[0].id,"3905"); assert.equal(seen[0].title,"Указатель");
});
