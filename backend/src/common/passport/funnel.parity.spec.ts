import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestValue, type FunnelValue } from './funnel';

/**
 * C028 R4 — сверка серверной подсказки `suggestValue` с эталоном скрипта R1
 * (backend/scripts/c028-suggest-facets.mjs). Снимок — backend/test/fixtures/c028-suggest.json,
 * чтобы тест работал без выгрузки tools/logs.
 */
const snap = JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/c028-suggest.json'), 'utf8')) as {
  facets: Record<string, Array<{ code: string; values: Array<{ code: string; name: string; order: number; words: string[] }> }>>;
  items: Array<{ name: string; category: string; expected: Record<string, string | null> }>;
};

const toServer = (values: Array<{ code: string; name: string; order: number; words: string[] }>): FunnelValue[] =>
  values.map((v) => ({ id: v.code, name: v.name, parentId: 'f', order: v.order, words: v.words }));

describe('C028 R4: suggestValue повторяет скрипт R1 на всей продукции', () => {
  for (const [category, facets] of Object.entries(snap.facets)) {
    const items = snap.items.filter((p) => p.category === category);
    if (!items.length) return; // категория без изделий (DSP) — сверять нечего
    const serverFacets = facets.map((f) => ({ code: f.code, values: toServer(f.values) }));
    it.each(items)('%s → %j', (p) => {
      for (const f of serverFacets) {
        const got = suggestValue(p.name, f.values);
        const want = p.expected[f.code];
        expect([p.name, f.code, got ? got.id : null]).toEqual([p.name, f.code, want]);
      }
    });
  }
});
