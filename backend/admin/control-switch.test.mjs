import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const scripts = ['control-switch-schedule.js', 'control-switch.js'].map(
  (file) => readFileSync(new URL(file, import.meta.url), 'utf8'),
);
const PATH = '/control/switch/schedule';

function fixture({ schedule, status } = {}) {
  let active, nextId = 0;
  const pending = new Map();
  class Element {
    constructor(tag, classes = '', text = '') {
      this.tag = tag;
      this.className = classes;
      this.text = text;
      this.children = [];
      this.events = {};
      this.attributes = {};
      this.classList = {
        contains: (value) => this.className.split(' ').includes(value),
        add: (value) => this.classList.toggle(value, true),
        remove: (value) => this.classList.toggle(value, false),
        toggle: (value, on) => {
          const classes = new Set(this.className.split(' ').filter(Boolean));
          if (on) classes.add(value);
          else classes.delete(value);
          this.className = [...classes].join(' ');
        },
      };
    }
    append(...children) {
      children.forEach((child) => { child.parent = this; });
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parent = null; });
      if (active && !active.isConnected) active = null;
      this.children = [];
      this.text = '';
      this.append(...children);
    }
    get isConnected() { return this === root || !!this.parent?.isConnected; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
    set textContent(value) { this.replaceChildren(); this.text = String(value); }
    get options() { return this.children; }
    get value() { return this.inputValue || ""; }
    set value(value) { this.inputValue = String(value); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, listener) { (this.events[type] ??= []).push(listener); }
    async fire(type, details = {}) {
      if (type === 'click' && this.disabled) return;
      await Promise.all((this.events[type] || []).map((listener) => listener({ preventDefault() {}, ...details })));
    }
    focus() { if (this.isConnected && !this.disabled && !this.hidden) active = this; }
    closest(selector) {
      const match = selector === "[hidden]" ? this.hidden : this.classList.contains(selector.slice(1));
      return match ? this : this.parent?.closest(selector);
    }
    querySelectorAll(selector) { return descendants(this).filter((child) => selector.split(',').includes(child.tag)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    matches(selector) { return selector === ":disabled" && !!this.disabled; }
    showModal() { this.open = true; }
    close() { this.open = false; return this.fire('close'); }
  }

  const root = new Element('main');
  const window = {};
  const calls = [], messages = [];
  let current = schedule || example();
  let server = status || serverStatus();
  let readError, readHandler, saveHandler;
  const api = async (path, opts) => {
    const method = opts?.method || 'GET';
    const body = opts?.body && JSON.parse(opts.body);
    calls.push({ path, method, body });
    if (path === PATH && method === 'GET') {
      if (readError) throw readError;
      if (readHandler) return readHandler();
      return structuredClone(current);
    }
    if (path === PATH && method === 'PUT') {
      if (saveHandler) await saveHandler(body);
      current = { ...current, revision: current.revision + 1, data: body.data, code: body.code };
      return structuredClone(current);
    }
    if (path === '/control/switch/refresh' && method === 'POST') {
      server.job = { state: 'queued', direction: 'refresh', refreshScope: body.scope };
      return server.job;
    }
    assert.equal(path, '/control/switch');
    return structuredClone(server);
  };

  const timer = (fn, delay) => { pending.set(++nextId, { fn, delay }); return nextId; };
  const clear = (id) => pending.delete(id);
  const context = vm.createContext({
    window, document: { createElement: (tag) => new Element(tag), get activeElement() { return active; } }, performance,
    setTimeout: timer, clearTimeout: clear, setInterval: timer, clearInterval: clear,
  });
  scripts.forEach((source) => vm.runInContext(source, context));
  window.dcSwitch.open(root, { api, el: (...args) => new Element(...args), toast: (message) => messages.push(message) });

  const button = (text) => named(root, 'button', text);
  const drawer = () => find(root, (node) => node.tag === 'aside');
  return {
    root, calls, messages, button, drawer, active: () => active,
    async open() { await button('Настроить расписание').fire('click'); return drawer(); },
    async submit() { return find(drawer(), (node) => node.tag === 'form').fire('submit'); },
    setSchedule(view) { current = view; },
    setStatus(view) { server = view; },
    rejectGet(error) { readError = error; },
    interceptGet(fn) { readHandler = fn; },
    interceptPut(fn) { saveHandler = fn; },
    async poll(delay = 30000) {
      const entry = [...pending].find(([, task]) => task.delay === delay);
      assert.ok(entry, 'Таймер опроса ' + delay + ' мс');
      pending.delete(entry[0]);
      await entry[1].fn();
      await settle();
    },
  };
}

const settle = () => new Promise(setImmediate);
const example = () => ({
  revision: 0, timezone: 'Europe/Moscow', canEdit: true,
  data: { enabled: true, mode: 'interval', intervalMinutes: 15, time: '02:00', days: [1, 2, 3, 4, 5, 6, 7] },
  code: { enabled: true, time: '03:00', days: [1, 2, 3, 4, 5] },
  runs: { data: {}, code: {} },
});
const serverStatus = () => ({
  enabled: true, self: 'home', role: 'main', mode: 'normal', version: '1.956',
  canRefresh: true, canStart: false,
  peer: { healthy: true, version: '1.955', copyAgeMin: 11 },
  domain: { owner: 'home', homeHealthy: true, officeHealthy: false, checkedAt: new Date().toISOString() },
  switchReadiness: { state: 'blocked', reasons: ['Версии отличаются.'] },
});

const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
const find = (node, predicate) => descendants(node).find(predicate);
const named = (node, tag, text) => find(node, (child) => child.tag === tag && child.textContent === text);
const group = (drawer, title) => find(drawer, (node) => node.tag === 'fieldset' && node.children[0].textContent === title);
const typed = (node, type) => find(node, (child) => child.tag === 'input' && child.type === type);
const day = (node, number) => find(node, (child) => child.tag === 'input' && child.type === 'checkbox' && child.value === String(number));
const puts = (fixture) => fixture.calls.filter((call) => call.method === 'PUT');
const change = (control, value) => {
  if (typeof value === 'boolean') control.checked = value;
  else control.value = value;
  return control.fire('change');
};

test('Два графика: применимые поля, сохранение полной формы, повторное открытие и отмена', async () => {
  const f = fixture();
  await settle();
  let drawer = await f.open();
  const data = group(drawer, 'Данные'), code = group(drawer, 'Код и данные');
  const close = f.button('Закрыть'), cancel = f.button('Отмена');
  close.focus();
  await drawer.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(f.active(), cancel);
  await drawer.fire('keydown', { key: 'Tab' });
  assert.equal(f.active(), close);
  const mode = find(data, (node) => node.tag === 'select');
  const interval = typed(data, 'number'), time = typed(data, 'time');
  assert.equal(interval.parent.hidden, false);
  assert.equal(time.parent.hidden, true);

  await change(interval, '35');
  await change(mode, 'daily');
  assert.equal(interval.parent.hidden, true);
  assert.equal(time.parent.hidden, false);
  time.value = '23:50';
  [2, 4, 5, 6].forEach((number) => { day(data, number).checked = false; });
  await change(mode, 'interval');
  assert.equal(interval.value, '35');
  await change(mode, 'daily');
  await change(typed(code, 'checkbox'), false);
  assert.equal(typed(code, 'time').parent.hidden, true);
  assert.equal(time.value, '23:50');
  await f.submit();
  assert.deepEqual(puts(f)[0].body, {
    expectedRevision: 0, timezone: 'Europe/Moscow',
    data: { enabled: true, mode: 'daily', intervalMinutes: 35, time: '23:50', days: [1, 3, 7] },
    code: { enabled: false, time: '03:00', days: [1, 2, 3, 4, 5] },
  });
  assert.equal(drawer.hidden, true);
  assert.equal(f.active(), f.button('Настроить расписание'));
  assert.deepEqual(f.messages, ['Расписание сохранено']);

  drawer = await f.open();
  assert.equal(typed(group(drawer, 'Данные'), 'time').value, '23:50');
  typed(group(drawer, 'Данные'), 'time').value = '11:00';
  await f.button('Отмена').fire('click');
  drawer = await f.open();
  assert.equal(typed(group(drawer, 'Данные'), 'time').value, '23:50');
  assert.equal(puts(f).length, 1);
});

test('Валидация активных минут, времени и дней, черновик скрытых полей не мешает сохранению', async () => {
  const f = fixture();
  await settle();
  const drawer = await f.open();
  const data = group(drawer, 'Данные'), code = group(drawer, 'Код и данные');
  const interval = typed(data, 'number'), time = typed(code, 'time');
  for (const bad of ['4', '1441', '5.5']) {
    interval.value = bad;
    await f.submit();
    assert.equal(f.active(), interval);
    assert.match(drawer.textContent, /целый интервал/);
  }
  interval.value = '5';
  time.value = '24:00';
  await f.submit();
  assert.equal(f.active(), time);
  assert.match(drawer.textContent, /Укажите время/);
  time.value = '00:00';
  [1, 2, 3, 4, 5].forEach((number) => { day(code, number).checked = false; });
  await f.submit();
  assert.equal(f.active(), day(code, 1));
  assert.match(drawer.textContent, /хотя бы один день/);
  assert.equal(puts(f).length, 0);

  await change(typed(code, 'checkbox'), false);
  time.value = '';
  await f.submit();
  assert.equal(puts(f)[0].body.data.intervalMinutes, 5);
  assert.deepEqual(puts(f)[0].body.code, { enabled: false, time: '03:00', days: [] });
});

test('409 по ревизии: введённый график остаётся и уходит только после явного решения с новой ревизией', async () => {
  const f = fixture();
  await settle();
  const drawer = await f.open();
  const interval = typed(group(drawer, 'Данные'), 'number');
  interval.value = '30';
  f.interceptPut(() => {
    const newer = example();
    newer.revision = 1;
    newer.data.intervalMinutes = 45;
    f.setSchedule(newer);
    f.interceptPut(null);
    throw { status: 409, body: { code: 'SCHEDULE_REVISION_CONFLICT' } };
  });
  await f.submit();
  assert.equal(puts(f)[0].body.expectedRevision, 0);
  assert.match(drawer.textContent, /Введённые значения сохранены/);
  assert.match(drawer.textContent, /Интервал 45 мин/);
  assert.equal(interval.value, '30');
  assert.equal(f.button('Сохранить').disabled, true);
  await f.submit();
  assert.equal(puts(f).length, 1);
  await f.button('Продолжить с моими настройками').fire('click');
  assert.equal(interval.value, '30');
  await f.submit();
  assert.equal(puts(f)[1].body.expectedRevision, 1);
  assert.equal(puts(f)[1].body.data.intervalMinutes, 30);
});

test('Поллинг обновляет результат и право сохранения, сохраняя узлы формы, фокус и черновик', async () => {
  const f = fixture();
  await settle();
  const drawer = await f.open();
  const interval = typed(group(drawer, 'Данные'), 'number');
  const edit = f.button('Настроить расписание');
  interval.value = '52';
  interval.focus();
  let snapshot = example();
  snapshot.canEdit = false;
  snapshot.reason = 'Идёт другая работа.';
  snapshot.runs.code = { lastState: 'done', lastWarning: 'Нужно проверить фото', lastSuccessAt: '2026-11-21T00:00:00Z' };
  f.setSchedule(snapshot);
  f.setStatus({ ...serverStatus(), job: { state: 'queued', direction: 'refresh', refreshScope: 'both' } });
  await f.poll();
  assert.match(f.root.textContent, /Нужно проверить фото/);
  assert.match(f.root.textContent, /03:00/);
  assert.match(drawer.textContent, /Идёт другая работа/);
  assert.equal(f.button('Сохранить').disabled, true);
  assert.equal(f.button('Настроить расписание'), edit);
  assert.equal(typed(group(drawer, 'Данные'), 'number'), interval);
  assert.equal(f.active(), interval);
  assert.equal(interval.value, '52');
  snapshot = example();
  f.setStatus(serverStatus());
  f.setSchedule(snapshot);
  await f.poll(3000);
  assert.equal(f.active(), interval);
  assert.equal(f.button('Сохранить').disabled, false);
});

test('Ошибки GET и PUT, повтор, защита от двойного сохранения и закрытия во время записи', async () => {
  const f = fixture();
  await settle();
  f.rejectGet(new Error('Связь прервалась'));
  await f.poll();
  assert.match(f.root.textContent, /Не удалось загрузить расписание/);
  f.rejectGet(null);
  await f.button('Повторить загрузку').fire('click');
  const drawer = await f.open();
  const interval = typed(group(drawer, 'Данные'), 'number');
  interval.value = '77';
  let reject;
  f.interceptPut(() => new Promise((_, fail) => { reject = fail; }));
  const saving = f.submit();
  await f.submit();
  await drawer.fire('keydown', { key: 'Escape' });
  await f.button('Закрыть').fire('click');
  assert.equal(puts(f).length, 1);
  assert.equal(drawer.hidden, false);
  reject({ status: 503, message: 'Запись на паузе' });
  await saving;
  assert.match(drawer.textContent, /Не удалось сохранить расписание. Запись на паузе/);
  assert.equal(interval.value, '77');

  f.interceptPut(null);
  await f.submit();
  assert.equal(puts(f)[1].body.expectedRevision, 0);
  assert.equal(puts(f)[1].body.data.intervalMinutes, 77);
});

test('Ручные команды работают при паузе, требуют подтверждения и отправляют разные области обновления', async () => {
  const schedule = example();
  schedule.data.enabled = schedule.code.enabled = false;
  const f = fixture({ schedule });
  await settle();
  assert.match(f.root.textContent, /Домен сейчас направлен на домашний сервер/);
  assert.match(f.root.textContent, /До офисного сервера с VPS Недоступен/);
  assert.match(f.root.textContent, /Версии отличаются/);
  assert.equal(f.button('Сделать главным').disabled, true);

  await f.button('Запустить данные сейчас').fire('click');
  await f.button('Отмена').fire('click');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 0);
  await f.button('Запустить данные сейчас').fire('click');
  await f.button('Обновить').fire('click');
  assert.deepEqual(f.calls.filter((call) => call.method === 'POST')[0], {
    method: 'POST', path: '/control/switch/refresh', body: { confirm: true, scope: 'data' },
  });
  assert.equal(f.button('Обновить код и данные сейчас').disabled, true);
  const progress = find(f.root, (node) => node.classList.contains('sw-job'));
  assert.equal(named(progress, 'span', 'Код'), undefined);

  f.setStatus({ ...serverStatus(), domain: { owner: null, homeHealthy: null, officeHealthy: null, checkedAt: null },
    switchReadiness: { state: 'unknown', reasons: ['VPS недоступен.'] } });
  await f.poll(3000);
  assert.match(f.root.textContent, /Куда направлен домен, пока неизвестно/);
  assert.match(f.root.textContent, /Готовность пока неизвестна/);
  await f.button('Обновить код и данные сейчас').fire('click');
  await f.button('Обновить').fire('click');
  assert.deepEqual(f.calls.filter((call) => call.method === 'POST')[1].body, { confirm: true, scope: 'both' });
});

test('Опоздавший GET не отменяет результат PUT и повторный опрос не дублирует его', async () => {
  const f = fixture();
  await settle();
  let sendOld;
  f.interceptGet(() => new Promise((resolve) => { sendOld = resolve; }));
  await f.poll();
  const reads = () => f.calls.filter((call) => call.method === 'GET' && call.path === PATH).length;
  const before = reads();
  await f.poll();
  assert.equal(reads(), before);

  let drawer = await f.open();
  typed(group(drawer, 'Данные'), 'number').value = '48';
  f.interceptGet(null);
  await f.submit();
  sendOld(example());
  await settle();
  assert.match(f.root.textContent, /Интервал 48 мин/);
  drawer = await f.open();
  assert.equal(typed(group(drawer, 'Данные'), 'number').value, '48');
});
