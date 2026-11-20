import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('./passport-source-picker.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
const clean = (value) => JSON.parse(JSON.stringify(value));
function setup({ confirm = true, error = null } = {}) {
  const calls = [], dialogs = [], events = [], downloads = [];
  const baseline = { selection: { mode: 'site', revision: 7 }, contextToken: 'baseline-7', sitePassports: [{ id: 'old', status: 'issued' }] };
  const node = (kind, attrs, ...children) => ({ kind, attrs, children });
  const sandbox = vm.createContext({
    api: async (path, options) => {
      calls.push({ path, options: options && clean(options) });
      if (options?.method === 'PUT' && error) throw error;
      return options?.method === 'POST' ? { url: '/api/files/chosen' } : baseline;
    }, PREFIX: '/db', h: (tag, attrs) => ({ tag, attrs, click() { downloads.push(attrs); }, remove() {} }),
    document: { body: { append() {} } }, window: { dispatchEvent(e) { events.push(e.type); } }, Event,
    kit: { confirmDlg: async (...args) => { dialogs.push(args); return confirm; },
      button: (attrs) => node('button', attrs), stack: (...children) => node('stack', null, ...children),
      row: (attrs) => node('row', attrs), badge: (...args) => node('badge', args), actions: (...children) => node('actions', null, ...children) },
  });
  vm.runInContext(code, sandbox);
  sandbox.attachmentSource = vm.runInContext('attachmentSource', sandbox);
  return { sandbox, calls, dialogs, events, downloads, baseline };
}

test('файл и attachment mode сохраняются одним PUT с исходной revision/token', async () => {
  const s = setup(); let saved = 0;
  await s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen', originalName: 'Паспорт.pdf', selectionGeneration: 2 }, { onSaved() { saved++; } });
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].path, '/passports/order/order/lines/line/source');
  assert.deepEqual(s.calls[1].options, { method: 'PUT', body: { mode: 'attachment', expectedRevision: 7, contextToken: 'baseline-7', attachmentId: 'chosen', expectedAttachmentGeneration: 2, confirm: true } });
  assert.match(s.dialogs[0][1], /Паспорт сайта останется в истории/);
  assert.deepEqual(s.events, ['data-changed']); assert.equal(saved, 1);
});

test('отмена подтверждения не пишет source и не меняет готовность', async () => {
  const s = setup({ confirm: false });
  assert.equal(await s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen' }), false);
  assert.equal(s.calls.length, 1); assert.deepEqual(s.events, []);
});

test('409 не повторяет PUT с новой revision и не сообщает успешное изменение', async () => {
  const error = Object.assign(new Error('Контекст изменён'), { status: 409 });
  const s = setup({ error });
  await assert.rejects(s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen' }, { view: s.baseline }), /Контекст изменён/);
  assert.equal(s.calls.length, 1); assert.deepEqual(s.events, []);
  assert.equal(s.calls[0].options.body.contextToken, 'baseline-7');
});

test('возврат к site не передаёт attachment или confirm и не вызывает выпуск', async () => {
  const s = setup();
  await s.sandbox.savePassportSource('order', 'line', s.baseline);
  assert.deepEqual(s.calls[0].options.body, { mode: 'site', expectedRevision: 7, contextToken: 'baseline-7' });
  assert.equal(s.calls.length, 1);
});

test('недоступный файл при attachment source не имеет действия скачивания и зелёной готовности', () => {
  const s = setup();
  const view = { state: 'blocked', source: 'attachment', attachment: { originalName: 'Паспорт.pdf', available: false }, missing: ['Файл пропал'] };
  const rendered = clean(s.sandbox.selectedPassportActions('order', 'line', view));
  const text = JSON.stringify(rendered);
  assert.match(text, /нужен файл/); assert.match(text, /Файл пропал/); assert.doesNotMatch(text, /Скачать паспорт/);
  assert.equal(s.sandbox.attachmentSource(view), true);
});

test('скачивание запрашивает тикет текущего выбора и передаёт baseline', async () => {
  const s = setup();
  await s.sandbox.downloadSelectedPassport('order', 'line', { contextToken: 'current', attachment: { originalName: 'Паспорт.pdf' } });
  assert.deepEqual(s.calls[0], { path: '/passports/order/order/lines/line/source/download-ticket', options: { method: 'POST', body: { contextToken: 'current' } } });
  assert.equal(s.downloads[0].href, '/db/api/files/chosen');
});
