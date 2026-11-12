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
  setAttribute() {}
  removeAttribute() {}
  append(...children) { this.children.push(...children.map((c) => c instanceof Element || c instanceof Text ? c : new Text(c))); }
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

async function fixture({ pending = true, commit } = {}) {
  const body = new Element('body');
  const reports = [];
  const document = {
    body, createElement: (tag) => new Element(tag), createTextNode: (text) => new Text(text),
    querySelector: (selector) => body.find((el) => selector === '.toasts' && el.className === 'toasts'),
    addEventListener() {},
  };
  const context = createContext({
    document, Element, DocumentFragment: class {}, Node: class {
      static [Symbol.hasInstance](node) { return node instanceof Element || node instanceof Text; }
    },
    window: { innerWidth: 390, addEventListener() {} }, setTimeout: () => 0,
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
    './busy.js': { busyBlock: noop, busyBtn: noop, failBlock: noop },
    './card-tabs.js': { buildCardTabs: noop },
    '../resizer.js': { makeResizable: noop },
    '../../core/prefs.js': { DOCK_MIN: 1000, getPref: noop, setPref: noop },
    '../../core/popout.js': { isSolo: () => false, popout: noop, setPopout: noop, soloGeometry: noop },
    '../notice-card.js': { noticeCard: ({ title }) => new Text(title), splitReason: (title) => ({ title }) },
    '../notices.js': { addNotice: noop },
  };
  const sources = new Map(Object.entries({
    './card.js': './card.js', './toast.js': './toast.js', '../../core/dom.js': '../../core/dom.js',
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
  }, { id: '3905' }, { close: () => assert.fail('Должен открыться просмотр карточки'), changed: noop });
  await tick();
  const done = body.find((el) => el.localName === 'button' && el.textContent === 'Готово');
  assert.ok(done);
  assert.equal(card.editing, true);
  assert.equal(calls.view, 1);
  return { card, calls, done, reports, body, edit };
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
