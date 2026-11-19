import { articleOfCategory } from '../../src/modules/expense-articles/articles-tree';
import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { FinancialArticleWriter } from '../../src/modules/expense-articles/financial-article-writer';
import { ExpenseArticlesService } from '../../src/modules/expense-articles/expense-articles.service';

describe('C161: дерево финансовых статей и все пути записи', () => {
  let ctx: TestContext, token: AuthTokens;
  const http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access), db = () => ctx.connection.db!;
  const tree = async () => (await http().get('/api/financial-articles?includeArchived=1').set(auth()).expect(200)).body;
  const get = async (id: string, key = 'financialArticles') => (await http().get(`/api/dicts/${key}/${id}`).set(auth()).expect(200)).body;
  const identity = async (id: string) => ({ version: (await get(id)).version, expectedTreeRevision: (await tree()).revision });
  const create = async (name: string, extra: object = {}, key = 'financialArticles') => (await http().post('/api/dicts/' + key).set(auth()).send({ name, nodeKind: 'group', expectedTreeRevision: (await tree()).revision, ...extra }).expect(201)).body;
  const patch = async (id: string, body: object, key = 'financialArticles') => http().patch(`/api/dicts/${key}/${id}`).set(auth()).send({ ...(await identity(id)), ...body });
  beforeAll(async () => { ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app); });
  afterAll(async () => { await ctx?.cleanup(); });
  it('рекурсивные ID/rename/reparent и legacy projection, оба типа не смешиваются', async () => {
    const root = await create('C159 Материалы'), group = await create('C159 Площадка', { parentId: root.id }), leaf = await create('C159 Бетон', { parentId: group.id, nodeKind: 'article', selectable: true });
    const income = await create('C159 Поступления', { type: 'income' });
    await patch(leaf.id, { name: 'C159 Бетон переименован', parentId: root.id }).then(r => expect(r.status).toBe(200));
    const projected = (await http().get('/api/expense-articles').set(auth()).expect(200)).body;
    expect(projected.items.some((r: any) => r.id === income.id)).toBe(false);
    expect(projected.items.find((r: any) => r.id === root.id).children).toEqual(expect.arrayContaining([expect.objectContaining({ id: leaf.id, name: 'C159 Бетон переименован' })]));
    await patch(leaf.id, { parentId: income.id }).then(r => expect(r.status).toBe(400));
    await patch(leaf.id, { type: 'income', parentId: income.id }, 'expenseArticles').then(r => expect(r.status).toBe(400));
    const groups = (await http().get('/api/dicts').set(auth()).expect(200)).body.items.flatMap((r: any) => r.items.map((x: any) => x.key));
    expect(groups).toContain('financialArticles'); expect(groups).not.toContain('expenseArticles'); expect(groups).not.toContain('incomeArticles');
  });
  it('конкурентные A→B/B→A не создаютцикл; stale возвращаеттекущуюревизию', async () => {
    const a = await create('C159 raceA'), b = await create('C159 raceB'), revision = (await tree()).revision;
    const results = await Promise.all([[a,b], [b,a]].map(([x,y]) => http().patch('/api/dicts/financialArticles/' + x.id).set(auth()).send({ parentId: y.id, version: x.version, expectedTreeRevision: revision })));
    expect(results.map(r => r.status).sort()).toEqual([200,409]);
    const conflict = results.find(r => r.status === 409)!; expect(conflict.body.currentTreeRevision).toBeGreaterThan(revision);
    expect((await tree()).diagnostics).toEqual([]);
  });
  it('archive/restore/remove: usedнельзяудалить, удалённыйreadнесётfreshversion', async () => {
    const root = await create('C159 Архив'), leaf = await create('C159 Использованная', { parentId: root.id, nodeKind: 'article', selectable: true });
    await db().collection('supplyinvoicepayments').insertOne({ allocations: [{ requestId: new Types.ObjectId(), articleId: new Types.ObjectId(leaf.id) }], state: 'voided' });
    await http().delete('/api/dicts/financialArticles/' + leaf.id).set(auth()).send(await identity(leaf.id)).expect(409);
    await patch(root.id, { archivedAt: new Date().toISOString() }).then(r => expect(r.status).toBe(409));
    await patch(leaf.id, { archivedAt: new Date().toISOString() }).then(r => expect(r.status).toBe(200));
    const selectable = ctx.module.get(ExpenseArticlesService); await expect(selectable.assertSelectable(leaf.id, 'expense')).rejects.toThrow();
    const unused = await create('C159 Удаляемая');
    const deleted = (await http().delete('/api/dicts/financialArticles/' + unused.id).set(auth()).send(await identity(unused.id)).expect(200)).body;
    expect(deleted.deletedAt).toBeTruthy(); expect((await get(unused.id)).version).toBe(deleted.version);
    await http().post(`/api/dicts/financialArticles/${unused.id}/restore`).set(auth()).send(await identity(unused.id)).expect(200);
    expect((await get(unused.id)).deletedAt).toBeNull();
    const child = await create('C159 deletedParentChild', { parentId: unused.id, nodeKind: 'article', selectable: true });
    await db().collection('expensearticles').updateOne({ _id: new Types.ObjectId(unused.id) }, { $set: { deletedAt: new Date() } });
    await patch(child.id, { name: 'C159 no orphan write' }).then(r => expect(r.status).toBe(400));
  });
  it('merge/import/rawdrop и неизвестныеполя не обходятwriter', async () => {
    const a = await create('C159 mergeA'), b = await create('C159 mergeB');
    for (const key of ['financialArticles','expenseArticles','incomeArticles']) await http().post(`/api/dicts/${key}/${a.id}/merge`).set(auth()).send({ intoId: b.id }).expect(409);
    await http().post('/api/dicts/financialArticles/import').set(auth()).send({ names: ['обход'] }).expect(400);
    await http().patch('/api/dicts/financialArticles/' + a.id).set(auth()).send({ ...(await identity(a.id)), arbitrary: true }).expect(400);
    await http().patch('/api/dicts/financialArticles/' + a.id).set(auth()).send({ name: 'withoutCAS' }).expect(400);
    await http().delete('/api/admin/collections/expensearticles').set(auth()).expect(409);
  });
  it('payrollrename/reparent не создаётвторойФОТпослерестартаseed', async () => {
    const payroll = await db().collection('expensearticles').findOne({ code: 'payroll' }), parent = await create('C159 Персонал');
    expect(payroll).toBeTruthy();
    await patch(String(payroll!._id), { name: 'C159 Переименованный ФОТ', parentId: parent.id }).then(r => expect(r.status).toBe(200));
    const before = await db().collection('expensearticles').countDocuments();
    expect(await ctx.module.get(ExpenseArticlesService).seed()).toEqual({ seeded: 0, payroll: false });
    expect(await db().collection('expensearticles').countDocuments()).toBe(before);
    expect(await db().collection('expensearticles').countDocuments({ code: 'payroll' })).toBe(1);
  });
  it('historyпослеresetостаётсяusage, а categoryhintнепереклассифицируетстаруюоплату', async () => {
    const historyRoot = await create('C159 Историческая группа');
    const history = await create('C159 Только история', { parentId: historyRoot.id, nodeKind: 'article', selectable: true });
    await db().collection('expenses').insertOne({ classificationHistory: [{ before: { articleId: new Types.ObjectId(history.id) }, after: { articleId: null } }] });
    await http().delete('/api/dicts/financialArticles/' + history.id).set(auth()).send(await identity(history.id)).expect(409);
    const hint = await create('C159 Подсказка', { parentId: historyRoot.id, nodeKind: 'article', selectable: true }), category = new Types.ObjectId(), invoice = new Types.ObjectId(), requestId = new Types.ObjectId();
    await db().collection('categories').insertOne({ _id: category, name: 'C159 legacyCategory', type: 'material', slug: 'c159-legacy-category', skuPrefix: 'TLC', deletedAt: null });
    await db().collection('supplyrequests').insertOne({ _id: requestId, invoiceId: invoice, paid: true, categoryId: category, articleId: null });
    await db().collection('supplyinvoices').insertOne({ _id: invoice, status: 'paid' });
    await patch(hint.id, { name: 'C159 Подсказка другое имя' }).then(r => expect(r.status).toBe(200));
    const denied = await patch(hint.id, { categoryIds: [String(category)] }); expect(denied.status).toBe(409); expect(denied.body.code).toBe('LEGACY_CLASSIFICATION_REVIEW_REQUIRED');
    await db().collection('expensearticles').updateOne({ _id: new Types.ObjectId(hint.id) }, { $set: { categoryIds: [category] } });
    await patch(hint.id, { archivedAt: new Date().toISOString() }).then(r => expect(r.status).toBe(409));
    await patch(hint.id, { selectable: false }).then(r => expect(r.status).toBe(409));
    await http().delete('/api/dicts/financialArticles/' + hint.id).set(auth()).send(await identity(hint.id)).expect(409);
    await db().collection('supplyinvoices').updateOne({ _id: invoice }, { $set: { legacyClassifications: { [String(requestId)]: { classificationOriginal: { articleId: null } } } } });
    await patch(hint.id, { categoryIds: [String(category)] }).then(r => expect(r.status).toBe(200));
    await patch(hint.id, { archivedAt: new Date().toISOString() }).then(r => expect(r.status).toBe(200));
  });

  it('archiveмеждучтениемисохранениемссылкивызываетretryвалидатораинесоздаётфакт', async () => {
    const raceRoot = await create('C159 reference race group');
    const article = await create('C159 reference race', { parentId: raceRoot.id, nodeKind: 'article', selectable: true }), service = ctx.module.get(ExpenseArticlesService), writer = ctx.module.get(FinancialArticleWriter);
    let reached!: () => void, release!: () => void, first = true;
    const read = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const original = writer.guardReference.bind(writer), spy = jest.spyOn(writer, 'guardReference').mockImplementation(async session => { if (first) { first = false; reached(); await gate; } return original(session); });
    const session = await ctx.connection.startSession(), fact = new Types.ObjectId();
    const source = session.withTransaction(async () => { await service.assertSelectable(article.id, 'expense', { session }); await db().collection('expenses').insertOne({ _id: fact, articleId: new Types.ObjectId(article.id) }, { session }); }).then(() => null, error => error);
    try { await read; await patch(article.id, { archivedAt: new Date().toISOString() }).then(r => expect(r.status).toBe(200)); release();
      expect(await source).toBeTruthy(); expect(await db().collection('expenses').countDocuments({ _id: fact })).toBe(0);
    } finally { release(); await source; spy.mockRestore(); await session.endSession(); }
  });

  it('rootarticle create/reparent400 с указанием родителя и без смены дерева/legacyhint', async () => {
    const root = await create('C159 required parent'), leaf = await create('C159 has parent', { parentId: root.id, nodeKind: 'article', selectable: true }), category = new Types.ObjectId(), invoice = new Types.ObjectId(), oldRequest = new Types.ObjectId();
    await db().collection('categories').insertOne({ _id: category, name: 'C159 root hint category', type: 'material', slug: 'c159-root-hint-category', skuPrefix: 'TRHP', deletedAt: null });
    await patch(leaf.id, { categoryIds: [String(category)] }).then(r => expect(r.status).toBe(200));
    await db().collection('supplyrequests').insertOne({ _id: oldRequest, invoiceId: invoice, categoryId: category, articleId: null, paid: true });
    await db().collection('supplyinvoices').insertOne({ _id: invoice, status: 'paid' });
    const revision = (await tree()).revision;
    expect(articleOfCategory(await ctx.module.get(ExpenseArticlesService).tree(), category)?.id).toBe(leaf.id);
    const denied = await http().post('/api/dicts/financialArticles').set(auth()).send({ name: 'C159 invalid rootarticle', nodeKind: 'article', selectable: true, expectedTreeRevision: revision }).expect(400);
    expect(denied.body.missing).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'parentId' })]));
    expect((await tree()).revision).toBe(revision);
    const moved = await patch(leaf.id, { parentId: null }); expect(moved.status).toBe(400);
    expect((await get(leaf.id)).parentId).toBe(root.id); expect((await tree()).revision).toBe(revision);
    expect(articleOfCategory(await ctx.module.get(ExpenseArticlesService).tree(), category)?.id).toBe(leaf.id);
    expect((await db().collection('supplyrequests').findOne({ _id: oldRequest }))!.articleId).toBeNull();
  });
  it('использованный бывшийleaf после превращения вgroup сохраняетID/source/legacylookup', async () => {
    const root = await create('C159 lookup root'), category = new Types.ObjectId(), sourceId = new Types.ObjectId();
    await db().collection('categories').insertOne({ _id: category, name: 'C159 former leaf category', type: 'material', slug: 'c159-former-leaf-category', skuPrefix: 'TFL', deletedAt: null });
    const former = await create('C159 former leaf', { parentId: root.id, nodeKind: 'article', selectable: true, categoryIds: [String(category)] });
    await db().collection('expenses').insertOne({ _id: sourceId, articleId: new Types.ObjectId(former.id) });
    await patch(former.id, { nodeKind: 'group', selectable: false }).then(r => expect(r.status).toBe(200));
    const child = await create('C159 new descendant', { parentId: former.id, nodeKind: 'article', selectable: true });
    const projected = (await http().get('/api/expense-articles').set(auth()).expect(200)).body.items.find((n: { id: string }) => n.id === root.id);
    expect(projected.children).toEqual(expect.arrayContaining([expect.objectContaining({ id: former.id, nodeKind: 'group', selectable: false, categoryIds: [String(category)] }), expect.objectContaining({ id: child.id, parentId: former.id, selectable: true })]));
    expect(String((await db().collection('expenses').findOne({ _id: sourceId }))!.articleId)).toBe(former.id);
    await expect(ctx.module.get(ExpenseArticlesService).assertSelectable(former.id, 'expense')).rejects.toThrow();
    expect(articleOfCategory(await ctx.module.get(ExpenseArticlesService).tree(), category)).toBeNull();
  });

});
