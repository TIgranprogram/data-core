import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../passports/funnel/test-vm.mjs';

/** C096 Э4: своя категория изделия — только явный выбор; без выбора категория остаётся по группе. */
async function fixture() {
  const puts = [];
  const mod = await load(new URL('./data.js', import.meta.url), {
    '../../core/api.js': { api: async (path, o) => { puts.push([path, o?.body]); return {}; } },
    '../passports/common.js': { V2_NUMS: [] },
  });
  return { mod, puts };
}

test('явно выбранная категория нового изделия сохраняется как своя', async () => {
  const f = await fixture();
  await f.mod.savePd('p1', { category: 'BLG', choices: {}, over: {}, derived: '', prev: {} });
  assert.equal(f.puts[0][1].passportCategory, 'BLG');
});

test('без выбора своя категория не пишется', async () => {
  const f = await fixture();
  await f.mod.savePd('p1', { category: '', choices: {}, over: { warrantyMonths: 12 }, derived: '', prev: {} });
  assert.equal('passportCategory' in f.puts[0][1], false);
});
