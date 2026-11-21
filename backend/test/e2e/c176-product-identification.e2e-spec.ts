import request from 'supertest';
import { Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { ShowcaseService } from '../../src/modules/showcase/showcase.service';

describe('C176: очередь и атомарная массовая идентификация', () => {
  let ctx: TestContext;
  let token: AuthTokens;
  const root = new Types.ObjectId(), group = new Types.ObjectId(), targetGroup = new Types.ObjectId();
  const bench = new Types.ObjectId(), trainer = new Types.ObjectId();
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(token.access);
  const db = () => ctx.connection.db!;
  const insert = async (name: string, fields: Record<string, unknown> = {}) => {
    const row = { _id: new Types.ObjectId(), sku: name, name, categoryId: group, status: 'active', listPrice: 100, deletedAt: null, ...fields };
    await db().collection('products').insertOne(row); return row;
  };
  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app);
    await ctx.module.get<{ init(): Promise<unknown> }>(getModelToken('Category')).init();
    await db().collection('dict_values').insertMany([
      { _id: bench, dict: 'passportKinds', name: 'C176 Скамья', passportCategory: 'BLG', deletedAt: null },
      { _id: trainer, dict: 'passportKinds', name: 'C176 Тренажёр', passportCategory: 'TRN', deletedAt: null },
    ]);
    await db().collection('categories').insertMany([
      { _id: root, type: 'product', name: 'C176 Благоустройство', slug: 'c176-root', skuPrefix: 'C176ROOT', parentId: null, passportCategory: 'BLG', deletedAt: null },
      { _id: group, type: 'product', name: 'C176 Скамьи', slug: 'c176-group', skuPrefix: 'C176GROUP', parentId: root, passportKindId: bench, deletedAt: null },
      { _id: targetGroup, type: 'product', name: 'C176 Другая группа', slug: 'c176-target', skuPrefix: 'C176TARGET', parentId: root, deletedAt: null },
    ]);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('фильтрует до пагинации и учитывает живой унаследованный вид вместо битого своего', async () => {
    await insert('C176-page-A', { passportDefaults: { kindId: String(new Types.ObjectId()) } });
    const missing = await insert('C176-page-Z', { categoryId: targetGroup });
    const all = (await http().get('/api/showcase').query({ search: 'C176-page', limit: 1 }).set(auth()).expect(200)).body;
    expect(all.total).toBe(2); expect(all.items[0].identificationIssues).toEqual([]);
    const filtered = (await http().get('/api/showcase').query({ search: 'C176-page', needsIdentification: 1, limit: 1 }).set(auth()).expect(200)).body;
    expect(filtered.total).toBe(1); expect(filtered.items[0].id).toBe(String(missing._id));
    expect(filtered.items[0].identificationIssues).toEqual([{ key: 'kind', label: 'Не выбран действующий вид изделия' }]);
  });

  it('серии фасета не обрезаются выбранной серией, остальные фильтры действуют', async () => {
    await insert('C176-series-A', { categoryId: targetGroup, series: 'C176-A' });
    await insert('C176-series-B', { categoryId: targetGroup, series: 'C176-B' });
    await insert('C176-series-C', { categoryId: group, series: 'C176-C' });
    await insert('C176-series-archived', { categoryId: targetGroup, status: 'archived', series: 'C176-D' });
    const r = (await http().get('/api/showcase').query({ search: 'C176-series', groupId: String(root), series: 'C176-A', facets: 1, needsIdentification: 1 }).set(auth()).expect(200)).body;
    expect(r.total).toBe(1); expect(r.items[0].series).toBe('C176-A');
    expect(r.facets.series).toEqual([{ value: 'C176-A', n: 1 }, { value: 'C176-B', n: 1 }]);
  });

  it('удалённый вид/группа, мусорная ссылка и неизвестный code не исчезают из очереди; MAF валиден', async () => {
    const deletedKind = new Types.ObjectId(), deletedGroup = new Types.ObjectId();
    await db().collection('dict_values').insertOne({ _id: deletedKind, dict: 'passportKinds', passportCategory: 'BLG', deletedAt: new Date() });
    await db().collection('categories').insertOne({ _id: deletedGroup, type: 'product', slug: 'c176-deleted', skuPrefix: 'C176DELETED', parentId: root, name: 'Удалена', deletedAt: new Date() });
    await insert('C176-invalid-kind', { categoryId: targetGroup, passportDefaults: { kindId: String(deletedKind) } });
    await insert('C176-invalid-group', { categoryId: deletedGroup, passportDefaults: { kindId: String(bench) } });
    await insert('C176-invalid-garbage', { categoryId: 'not-an-id' });
    await insert('C176-invalid-code', { passportDefaults: { passportCategory: 'OTHER' } });
    await insert('C176-invalid-MAF', { passportDefaults: { passportCategory: 'MAF' } });
    const r = (await http().get('/api/showcase').query({ search: 'C176-invalid', needsIdentification: 1 }).set(auth()).expect(200)).body;
    expect(r.total).toBe(4); expect(r.items.some((x: { name: string }) => x.name.endsWith('MAF'))).toBe(false);
  });

  it('mixed type/kind даёт partial без ранней записи группы/цены; defaults и issued сохранены, undo защищён', async () => {
    const good = await insert('C176-bulk-good', { categoryId: targetGroup, passportDefaults: { passportCategory: 'BLG', warrantyMonths: 12, simpleDescription: { text: 'Ручная формулировка.' } } });
    const bad = await insert('C176-bulk-bad', { passportDefaults: { passportCategory: 'TRN', warrantyMonths: 24 } });
    const outside = await insert('C176-bulk-outside');
    const issued = { _id: new Types.ObjectId(), productId: good._id, status: 'issued', revision: 3, passportNumber: 123, textSnapshot: { description: 'Исторический текст' }, deletedAt: null };
    await db().collection('productpassports').insertOne(issued);
    const rawBefore = await db().collection('products').findOne({ _id: bad._id });
    const r = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(good._id), String(bad._id)], set: { group: 'C176 Скамьи', price: 999, passportDefaults: { kindId: String(bench) } } }).expect(200)).body;
    expect(r.updated).toBe(1); expect(r.failed).toHaveLength(1); expect(r.failed[0].id).toBe(String(bad._id));
    expect(await db().collection('products').findOne({ _id: bad._id })).toEqual(rawBefore);
    const rejected = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(bad._id)], set: { group: 'C176-не-должна-появиться', price: 999, passportDefaults: { kindId: String(bench) } } }).expect(200)).body;
    expect(rejected.updated).toBe(0); expect(rejected.failed).toHaveLength(1);
    expect(await db().collection('categories').findOne({ name: 'C176-не-должна-появиться' })).toBeNull();
    expect(r.before).toHaveLength(1); expect(r.before[0].expected).toMatch(/^[a-f0-9]{64}$/);
    const changed = await db().collection('products').findOne({ _id: good._id });
    expect(changed?.passportDefaults).toMatchObject({ kindId: String(bench), warrantyMonths: 12, simpleDescription: { text: 'Ручная формулировка.' } });
    expect(changed?.listPrice).toBe(999); expect(String(changed?.categoryId)).toBe(String(group));
    expect(await db().collection('products').findOne({ _id: outside._id })).toEqual(outside);
    expect(await db().collection('productpassports').findOne({ _id: issued._id })).toEqual(issued);
    // Конкурентное изменение затронутого поля не сносится автоматической отменой.
    await db().collection('products').updateOne({ _id: good._id }, { $set: { listPrice: 1001 } });
    const undo = (await http().post('/api/showcase/bulk/restore').set(auth()).send({ items: r.before }).expect(200)).body;
    expect(undo.restored).toBe(0); expect(undo.failed).toHaveLength(1);
    expect((await db().collection('products').findOne({ _id: good._id }))?.listPrice).toBe(1001);
  });

  it('успешное уточнение выбранных двух исчезает из очереди; обычная отмена возвращает пробел', async () => {
    const a = await insert('C176-fix-A', { categoryId: targetGroup, passportDefaults: { serviceLifeYears: 10 } });
    const b = await insert('C176-fix-B', { categoryId: targetGroup });
    const r = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(a._id), String(b._id)], set: { passportDefaults: { kindId: String(bench), passportCategory: 'BLG' } } }).expect(200)).body;
    expect(r.updated).toBe(2); expect(r.failed).toEqual([]);
    expect((await http().get('/api/showcase').query({ search: 'C176-fix', needsIdentification: 1 }).set(auth()).expect(200)).body.total).toBe(0);
    const undo = (await http().post('/api/showcase/bulk/restore').set(auth()).send({ items: r.before }).expect(200)).body;
    expect(undo.restored).toBe(2); expect(undo.failed).toEqual([]);
    expect((await db().collection('products').findOne({ _id: a._id }))?.passportDefaults).toEqual({ serviceLifeYears: 10 });
    expect((await http().get('/api/showcase').query({ search: 'C176-fix', needsIdentification: 1 }).set(auth()).expect(200)).body.total).toBe(2);
  });

  it('kind-only не меняет унаследованный тип; согласованная явная смена kind+type разрешена', async () => {
    const trnRoot = new Types.ObjectId(), trnGroup = new Types.ObjectId();
    await db().collection('categories').insertMany([
      { _id: trnRoot, type: 'product', slug: 'c176-trn-root', skuPrefix: 'C176TRNROOT', name: 'C176 Тренажёры', passportCategory: 'TRN', parentId: null, deletedAt: null },
      { _id: trnGroup, type: 'product', slug: 'c176-trn-group', skuPrefix: 'C176TRNGROUP', name: 'C176 Группа тренажёров', parentId: trnRoot, passportKindId: trainer, deletedAt: null },
    ]);
    const row = await insert('C176-inherited-type', { categoryId: trnGroup });
    const rejected = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(row._id)], set: { passportDefaults: { kindId: String(bench) } } }).expect(200)).body;
    expect(rejected.updated).toBe(0); expect(rejected.failed).toHaveLength(1);
    expect(await db().collection('products').findOne({ _id: row._id })).toEqual(row);
    const accepted = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(row._id)], set: { passportDefaults: { kindId: String(bench), passportCategory: 'BLG' } } }).expect(200)).body;
    expect(accepted.updated).toBe(1); expect(accepted.failed).toEqual([]);
    expect((await db().collection('products').findOne({ _id: row._id }))?.passportDefaults).toEqual({ kindId: String(bench), passportCategory: 'BLG' });
  });

  it.each([
    ['status', { status: 'not-a-status' }],
    ['designer', { designerId: String(new Types.ObjectId()) }],
  ])('новая группа и неверный %s не оставляют категорию или правку изделия', async (suffix, invalid) => {
    const row = await insert(`C176-group-invalid-${suffix}`);
    const groupName = `C176-rollback-${suffix}`;
    const result = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(row._id)], set: { group: groupName, price: 500, ...invalid } }).expect(200)).body;
    expect(result.updated).toBe(0); expect(result.failed).toHaveLength(1);
    expect(await db().collection('products').findOne({ _id: row._id })).toEqual(row);
    expect(await db().collection('categories').findOne({ name: groupName })).toBeNull();
  });

  it('потеря CAS откатывает созданную категорию и не затирает конкурентную цену', async () => {
    const row = await insert('C176-group-cas-lost');
    await db().collection('products').updateOne({ _id: row._id }, { $set: { listPrice: 777 } });
    const service = ctx.module.get(ShowcaseService) as unknown as {
      applyBulkRow(raw: Record<string, unknown>, patch: Record<string, unknown>): Promise<unknown>;
    };
    await expect(service.applyBulkRow(row, { type: 'C176 Благоустройство', group: 'C176-rollback-lost-cas', price: 500 })).rejects.toThrow('Изделие изменено');
    expect(await db().collection('categories').findOne({ name: 'C176-rollback-lost-cas' })).toBeNull();
    expect((await db().collection('products').findOne({ _id: row._id }))?.listPrice).toBe(777);
  });

  it('корректная новая группа и правка изделия фиксируются вместе', async () => {
    const row = await insert('C176-group-commit');
    const r = (await http().post('/api/showcase/bulk').set(auth()).send({ ids: [String(row._id)], set: { group: 'C176-created-group', price: 400, passportDefaults: { kindId: String(bench) } } }).expect(200)).body;
    expect(r.updated).toBe(1); expect(r.failed).toEqual([]);
    const category = await db().collection('categories').findOne({ name: 'C176-created-group' });
    expect(category).not.toBeNull();
    const product = await db().collection('products').findOne({ _id: row._id });
    expect(String(product?.categoryId)).toBe(String(category?._id)); expect(product?.listPrice).toBe(400);
  });
});
