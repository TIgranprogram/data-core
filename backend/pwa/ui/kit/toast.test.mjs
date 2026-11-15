import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

test('пойманная ошибка сохранения передаётся сборщику до подавления повторного уведомления', async () => {
  const reports = []; const shown = [];
  const box = { append: (item) => shown.push(item) };
  const context = createContext({ Date, Map, setTimeout: () => 0, document: { querySelector: () => box } });
  const deps = {
    './mark.js': { mark: (el) => el },
    '../../core/dom.js': { h: () => ({}) },
    './errors.js': { actionText: () => 'Не удалось сохранить: ошибка', isFailure: () => true },
    '../notice-card.js': { noticeCard: () => ({ remove() {} }), splitReason: (title) => ({ title }) },
    '../notices.js': { addNotice() {} },
    '../../core/errors.js': { reportError: (error, meta) => reports.push({ error, meta }) },
  };
  const module = new SourceTextModule(readFileSync(new URL('./toast.js', import.meta.url), 'utf8'), { context });
  await module.link((path) => {
    const values = deps[path];
    assert.ok(values, `Неожиданный импорт ${path}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const error = new TypeError('Не удалось обработать ответ');
  module.namespace.toastError(error, 'сохранить');
  module.namespace.toastError(error, 'сохранить');
  assert.equal(reports.length, 2); // дедупликация отчётов — обязанность core/errors
  assert.equal(shown.length, 1);
  assert.equal(reports[0].error, error);
  assert.equal(reports[0].meta.action, 'сохранить');
  assert.deepEqual(Object.keys(reports[0].meta), ['action']); // данные формы не передаются
});

test('сообщение встаёт над нижней строкой панели у низа экрана (обход 15.11, 390)', async () => {
  let rects = [];
  const box = { style: { bottom: '' }, append() {} };
  const context = createContext({ Date, Map, setTimeout: () => 0, window: { innerHeight: 844 },
    document: { querySelector: () => box, querySelectorAll: () => rects.map((r) => ({ getBoundingClientRect: () => r })) } });
  const stub = { './mark.js': { mark: (el) => el }, '../../core/dom.js': { h: () => ({}) }, './errors.js': { actionText: () => '', isFailure: () => false },
    '../notice-card.js': { noticeCard: () => ({}), splitReason: (t) => ({ title: t }) }, '../notices.js': { addNotice() {} }, '../../core/errors.js': { reportError() {} } };
  const mod = new SourceTextModule(readFileSync(new URL('./toast.js', import.meta.url), 'utf8'), { context });
  await mod.link((p) => new SyntheticModule(Object.keys(stub[p]), function () { for (const [k, v] of Object.entries(stub[p])) this.setExport(k, v); }, { context }));
  await mod.evaluate();
  const { toast } = mod.namespace;
  rects = [{ top: 700, bottom: 844, height: 144 }]; toast('a', { notice: false });
  assert.equal(box.style.bottom, '152px'); // 844 − 700 + 8
  rects = [{ top: 300, bottom: 400, height: 100 }]; toast('b', { notice: false }); // строка не у низа — место из CSS
  assert.equal(box.style.bottom, '');
  rects = []; toast('c', { notice: false }); // панели нет
  assert.equal(box.style.bottom, '');
});
