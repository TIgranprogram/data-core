/** Проверка запрета частичного применения до полного preflight C164. */
const { SPECS, ensure } = require('../../../scripts/c164-source-indexes.js'); // eslint-disable-line @typescript-eslint/no-var-requires
const lastIndex = SPECS[SPECS.length - 1][1] as string;
type Spec = [string, string, Record<string, number>, Record<string, unknown>];
function database(options: { missing?: string[]; conflict?: string; duplicate?: string } = {}) {
 const created: string[] = [], specs = SPECS as Spec[];
 const ready = new Set(specs.map(s => s[1]).filter(n => !options.missing?.includes(n)));
 const db = { collection: (name: string) => ({
  indexes: async () => [{ name: '_id_', key: { _id: 1 } }, ...specs.filter(s => s[0] === name && ready.has(s[1])).map(s => ({ name:s[1], key:s[2], unique:true, partialFilterExpression:s[3], ...(options.conflict === s[1] ? { sparse:true } : {}) }))],
  aggregate: (pipeline: Array<Record<string, any>>) => ({ toArray: async () => options.duplicate && specs.some(s => s[0] === name && s[1] === options.duplicate && JSON.stringify(s[3]) === JSON.stringify(pipeline[0].$match)) ? [{ n:2 }] : [] }),
  createIndex: async (_key: unknown, spec: { name:string }) => { created.push(spec.name); ready.add(spec.name); },
 }) };
 return { db, created };
}
describe('C164 — безопасные служебные индексы', () => {
 it('конфликт последнего индекса останавливает весь apply до первой записи', async () => {
  const { db, created } = database({ missing:['c164_sales_intake_uid'], conflict:lastIndex });
  await expect(ensure(db, true)).rejects.toThrow('INDEX_CONFLICT'); expect(created).toEqual([]);
 });
 it('дубликаты последней коллекции блокируют ранее запланированное создание', async () => {
  const { db, created } = database({ missing:['c164_sales_intake_uid'], duplicate:lastIndex });
  await expect(ensure(db, true)).rejects.toThrow('DUPLICATES'); expect(created).toEqual([]);
 });
 it('план ничего не пишет, apply добавляет только missing, повтор ничего не создаёт', async () => {
  const { db, created } = database({ missing:['c164_offer_intake_uid'] });
  expect((await ensure(db)).find((x: { name:string }) => x.name === 'c164_offer_intake_uid').state).toBe('missing');
  expect(created).toEqual([]);
  expect((await ensure(db, true)).filter((x: { state:string }) => x.state === 'created')).toHaveLength(1);
  expect(created).toEqual(['c164_offer_intake_uid']); await ensure(db, true);
  expect(created).toEqual(['c164_offer_intake_uid']);
 });
});
