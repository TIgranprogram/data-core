import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { formImages, imagesBody } from '../../core/passport-images.js';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const withoutImports = (s) => s.replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('старая форма сохраняет собственные рисунки и не копирует наследуемые', () => {
  const sandbox = vm.createContext({
    V2_NUMS: [], num: (v) => v ?? '', bomRows: () => '', parseBom: () => [],
    kinds: () => [['overview', 'Общий вид']], kindOf: (i) => i.kind,
    buildDescription: () => '', specBody: () => ({}), isIssued: () => false, formImages, imagesBody,
  });
  const common = read('./common.js').match(/^export const imgsOf = .+$/m)[0].replace('export ', '');
  vm.runInContext(common + '\n' + withoutImports(read('./form.js')) + '\nglobalThis.form = passportForm;', sandbox);
  const row = { images: [{ kind: 'overview', photoId: 'own', url: '/own.png' }], effectiveImages: [{ kind: 'overview', photoId: 'inherited', url: '/inherited.png', fromProduct: true }] };
  const values = sandbox.form.toInitial(row);
  assert.equal(values.img_overview[0].id, 'own');
  values.img_overview = values.img_overview.map((i) => i.id);
  const result = sandbox.form.toBody(values, row);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].photoId, 'own');
});
function el() {
  const events = {};
  return { children: [], classList: { toggle() {} }, addEventListener(k, fn) { events[k] = fn; }, events,
    replaceChildren(...xs) { this.children = xs; }, append(...xs) { this.children.push(...xs); } };
}

test('быстрый второй выбор сохраняется после первого запроса и не сбрасывается перерисовкой', async () => {
  const timers = [], funnels = [], writes = [];
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  let saved = {};
  const ctx = { S: { r: { passportCategory: 'BLG', textChoices: {} } }, can: true, pid: () => 'p1',
    lock: (fn) => fn(), onChanged() {},
    refreshRow: async () => { ctx.S.r = { passportCategory: 'BLG', textChoices: saved }; },
    patchPassport: async (body) => { writes.push(body); if (writes.length === 1) await first; saved = body.textChoices; } };
  const sandbox = vm.createContext({
    api: async () => ({ passportCategory: 'BLG', textChoices: saved }),
    h: () => el(), toastError: (e) => { throw e; }, V2_CATS: [],
    makeFunnel: ({ value }) => { const f = { el: el(), value, installTypeId: () => '' }; funnels.push(f); return f; },
    setTimeout: (fn) => { timers.push(fn); return fn; },
    clearTimeout: (fn) => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
  });
  const code = withoutImports(read('./book-choices.js')).replace("await import('../../ui/funnel.js')", '{ funnelBox: makeFunnel }');
  vm.runInContext(code + '\nglobalThis.mount = mountBookChoices;', sandbox);
  const widget = sandbox.mount(el(), ctx);
  await tick();
  const f = funnels[0];
  f.value = '{"purpose":"A"}'; f.el.events.change();
  const saving = timers.shift()();
  await tick();
  f.value = '{"purpose":"B"}'; f.el.events.change();
  await timers.shift()();
  await widget.refresh();
  assert.equal(funnels.length, 1);
  releaseFirst(); await saving;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].textChoices.purpose, 'B');
  assert.equal(ctx.S.r.textChoices.purpose, 'B');
});

test('пустой способ установки сериализуется как явная очистка, отсутствующее поле не меняется', () => {
  const s = read('./form.js');
  const code = s.slice(s.indexOf('export function v2Body'), s.indexOf('export const passportForm')).replace('export ', '');
  const sandbox = vm.createContext({ V2_NUMS: [] });
  vm.runInContext(code + '\nglobalThis.body = v2Body;', sandbox);
  assert.equal(sandbox.body({ installationTypeId: '' }).installationTypeId, null);
  assert.equal(sandbox.body({ installationTypeId: 'id1' }).installationTypeId, 'id1');
  assert.equal(Object.hasOwn(sandbox.body({}), 'installationTypeId'), false);
});

test('пустая таблица очищает автоматический текст материалов, ручной сохраняется до явного сброса', () => {
  let again;
  const sandbox = vm.createContext({ h: () => el(), button: (opts) => { again = opts; return el(); } });
  vm.runInContext(withoutImports(read('./materials.js')) + '\nglobalThis.wire = wireMaterials;', sandbox);
  const ta = el(); ta.value = '';
  const ms = { el: el(), spec: () => null };
  const api = { get: () => '', input: () => ta, field: () => el(), set: (key, value) => { if (key === 'materials') ta.value = value; } };
  sandbox.wire(api, { r: {}, md: { mats: [] }, ctx: { ms } });
  ms.onText('Изготовлено из стали.');
  assert.equal(ta.value, 'Изготовлено из стали.');
  ms.onText('');
  assert.equal(ta.value, '');
  ta.value = 'Ручной текст.'; ta.events.input({ isTrusted: true });
  ms.onText(''); assert.equal(ta.value, 'Ручной текст.');
  again.onClick(); assert.equal(ta.value, '');
});
