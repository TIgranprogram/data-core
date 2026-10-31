import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** «Справочники» (TASKS СП.4–СП.8): правка, запрет удаления занятого, объединение дублей, перенос из данных, выпадающие списки. */
describe('Dicts', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('группы и справочники со счётчиками', async () => {
    const g = (await http().get('/api/dicts').set(auth()).expect(200)).body.items;
    expect(g.map((x: { group: string }) => x.group)).toEqual(['Склад и позиции', 'Люди и ФОТ', 'Заявки и счета', 'Продукция', 'Паспорта']);
    expect(g[0].items.map((x: { key: string }) => x.key)).toEqual(['categories', 'productGroups', 'productSections', 'units', 'writeOffReasons', 'colors', 'metalAssortments', 'steelGrades']);
    await http().get('/api/dicts/nope').set(auth()).expect(404);
  });

  it('единицы: дубль — 409, занятую удалить нельзя, объединение переносит заявки, удаление и восстановление', async () => {
    const a = (await http().post('/api/dicts/units').set(auth()).send({ symbol: 'пог.м', label: 'Метр погонный' }).expect(201)).body;
    expect(a).toMatchObject({ name: 'пог.м', label: 'Метр погонный' });
    expect(a).not.toHaveProperty('used');
    expect((await http().get(`/api/dicts/units/${a.id}/usage`).set(auth()).expect(200)).body).toEqual({ busy: false, sections: [], tracked: true, locked: null });
    await http().post('/api/dicts/units').set(auth()).send({ symbol: 'ПОГ.М' }).expect(409);
    const b = (await http().post('/api/dicts/units').set(auth()).send({ symbol: 'мп' }).expect(201)).body;
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Труба 40×20', qty: 6, unit: 'мп', clientUid: 'd-1' }).expect(201);
    const list = (await http().get('/api/dicts/units').set(auth()).expect(200)).body;
    expect(list.items.find((x: { id: string }) => x.id === b.id)).not.toHaveProperty('used');
    expect((await http().get(`/api/dicts/units/${b.id}/usage`).set(auth()).expect(200)).body).toEqual({ busy: true, sections: ['Остатки', 'Заявки'], tracked: true, locked: null });
    expect((await http().delete(`/api/dicts/units/${b.id}`).set(auth()).expect(409)).body.message).toContain('замените');
    const m = (await http().post(`/api/dicts/units/${b.id}/merge`).set(auth()).send({ intoId: a.id }).expect(200)).body;
    expect(m).toMatchObject({ id: a.id, moved: 1 });
    const reqs = (await http().get('/api/supply/requests').set(auth()).expect(200)).body.items;
    expect(reqs.find((x: { title: string }) => x.title === 'Труба 40×20').unit).toBe('пог.м');
    const c = (await http().post('/api/dicts/units').set(auth()).send({ symbol: 'рул' }).expect(201)).body;
    await http().delete(`/api/dicts/units/${c.id}`).set(auth()).expect(200);
    await http().get(`/api/dicts/units/${c.id}`).set(auth()).expect(404);
    await http().post(`/api/dicts/units/${c.id}/restore`).set(auth()).expect(200);
    // выпадающий список единиц — из справочника
    const lk = (await http().get('/api/supply/lookups').set(auth()).expect(200)).body;
    expect(lk.units).toEqual(expect.arrayContaining(['пог.м', 'рул']));
    expect(lk.units).not.toContain('мп');
  });

  it('переименование занятой единицы идёт каскадом: заявки получают новое название, ответ несёт moved', async () => {
    const u = (await http().post('/api/dicts/units').set(auth()).send({ symbol: 'бух' }).expect(201)).body;
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Канат', qty: 1, unit: 'бух', clientUid: 'd-3' }).expect(201);
    const r = (await http().patch(`/api/dicts/units/${u.id}`).set(auth()).send({ symbol: 'бухта' }).expect(200)).body;
    expect(r).toMatchObject({ name: 'бухта', moved: 1 });
    const reqs = (await http().get('/api/supply/requests').set(auth()).expect(200)).body.items;
    expect(reqs.find((x: { title: string }) => x.title === 'Канат').unit).toBe('бухта');
    // паспорт справочника в ответе списка
    const cats = (await http().get('/api/dicts/passportCategories').set(auth()).expect(200)).body;
    expect(cats.dict.sections).toEqual(['Документация', 'Продукция']);
    expect(cats.dict.refBy).toBe('id');
  });

  it('сотрудники: перенос «кто подал» из заявок, вид работ и график, ставка, список «кто подал»', async () => {
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Электроды', qty: 2, requestedBy: 'Сергей Апошнянский', clientUid: 'd-2' }).expect(201);
    const cand = (await http().get('/api/dicts/persons/candidates').set(auth()).expect(200)).body.items;
    expect(cand).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Сергей Апошнянский', uses: 1 })]));
    expect((await http().post('/api/dicts/persons/import').set(auth()).send({ names: ['Сергей Апошнянский'] }).expect(200)).body).toEqual({ added: 1 });
    const wt = (await http().post('/api/dicts/worktypes').set(auth()).send({ name: 'Сварщик' }).expect(201)).body;
    const ps = (await http().post('/api/dicts/payoutSchedules').set(auth()).send({ name: '10 и 25 числа', days: '10, 25' }).expect(201)).body;
    const people = (await http().get('/api/dicts/persons').set(auth()).expect(200)).body;
    const p = people.items.find((x: { name: string }) => x.name === 'Апошнянский Сергей');
    expect(p).toMatchObject({ status: 'active' });
    expect((await http().get(`/api/dicts/persons/${p.id}/usage`).set(auth()).expect(200)).body).toMatchObject({ busy: true, tracked: true });
    const upd = (await http().patch(`/api/dicts/persons/${p.id}`).set(auth()).send({ workTypeId: wt.id, payoutScheduleId: ps.id, salaryKind: 'hour', salaryRate: '450' }).expect(200)).body;
    expect(upd).toMatchObject({ workTypeName: 'Сварщик', payoutScheduleName: '10 и 25 числа', salaryRate: 450 });
    expect(upd.moved).toBe(0);
    const w = (await http().get(`/api/dicts/worktypes/${wt.id}`).set(auth()).expect(200)).body;
    expect(w).not.toHaveProperty('used');
    expect((await http().get(`/api/dicts/worktypes/${wt.id}/usage`).set(auth()).expect(200)).body.busy).toBe(true);
    expect((await http().get('/api/supply/lookups').set(auth()).expect(200)).body.requestedBy).toEqual(['Сергей Апошнянский']);
  });
});
