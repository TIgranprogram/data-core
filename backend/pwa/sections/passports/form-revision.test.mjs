// node --experimental-vm-modules --test backend/pwa/sections/passports/form-revision.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

/** C096 Э1: «Новая редакция» не теряется при ошибке сохранения и не повторяется после успешного PATCH. */
async function fixture({ failPatch = 0, failGet = 0 } = {}) {
  const calls = [];
  const st = { revisionFor: null };
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body, query: opts.query });
    if ((opts.method === 'PATCH') && failPatch > 0) { failPatch--; throw new Error('PATCH упал'); }
    if (!opts.method && failGet > 0) { failGet--; throw new Error('GET упал'); }
    return { id: 'p1' };
  };
  const src = readFileSync(new URL('./form.js', import.meta.url), 'utf8');
  const context = createContext({});
  const mod = new SourceTextModule(src, { context });
  const noop = () => {};
  await mod.link((key, ref) => {
    // все именованные импорты из этого модуля — заглушки; нужные — свои
    const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].filter((m) => m[2] === key).flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    const own = {
      '../../core/api.js': { api },
      './common.js': { st, AFTER_PRINT: ['saleDate', 'customerName', 'note'] },
    }[key] || {};
    const values = Object.fromEntries(names.map((n) => [n, n in own ? own[n] : noop]));
    return new SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context });
  });
  await mod.evaluate();
  return { form: mod.namespace.passportForm, st, calls };
}

const body = { _issued: true, name: 'Новое имя', note: 'заметка' };
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');

test('PATCH редакции упал — повтор уходит целиком с newRevision', async () => {
  const { form, st, calls } = await fixture({ failPatch: 1 });
  st.revisionFor = 'p1';
  await assert.rejects(form.update('p1', { ...body }));
  assert.equal(st.revisionFor, 'p1', 'намерение сохранено');
  await form.update('p1', { ...body });
  const [first, second] = patches(calls);
  assert.equal(JSON.stringify(first.query), '{"newRevision":1}');
  assert.equal(JSON.stringify(second.query), '{"newRevision":1}');
  assert.equal(second.body.name, 'Новое имя', 'полный payload, а не только «после печати»');
  assert.equal(st.revisionFor, null);
});

test('PATCH прошёл, чтение упало — повтор не создаёт ещё одну редакцию', async () => {
  const { form, st, calls } = await fixture({ failGet: 1 });
  st.revisionFor = 'p1';
  await assert.rejects(form.update('p1', { ...body }));
  assert.equal(st.revisionFor, null, 'после успешного PATCH намерение снято');
  await form.update('p1', { ...body });
  const [, second] = patches(calls);
  assert.equal(second.query, undefined, 'без newRevision');
  assert.equal(Object.keys(second.body).sort().join(), 'note', 'только поля «после печати»');
});

test('чужой паспорт: намерение редакции другого id не трогается', async () => {
  const { form, st, calls } = await fixture();
  st.revisionFor = 'other';
  await form.update('p1', { ...body });
  assert.equal(patches(calls)[0].query, undefined);
  assert.equal(st.revisionFor, 'other');
});
