import request from 'supertest';
import { Types } from 'mongoose';
import { writeFileSync } from 'fs';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

describe('C132: текст паспорта и прямое сохранение источника', () => {
  let ctx: TestContext;
  let admin: string;
  let manager: string;
  let director: string;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const as = authHeader;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = (await loginAsAdmin(ctx.app)).access;
    for (const role of ['manager', 'director']) {
      const username = `c132-${role}`;
      await http().post('/api/admin/users').set(as(admin)).send({ username, password: 'C132RoleTest123!', role }).expect(201);
      const login = await http().post('/api/auth/login').send({ username, password: 'C132RoleTest123!' }).expect(200);
      if (role === 'manager') manager = login.body.access; else director = login.body.access;
    }
  });
  afterAll(async () => { await ctx?.cleanup(); });

  async function fixture() {
    const element = new Types.ObjectId();
    await db().collection('dict_values').insertOne({ _id: element, dict: 'passportElements', code: String(element), name: 'Элемент C132', usageRules: 'Осмотреть крепления', deletedAt: null });
    await db().collection('products').insertMany([1, 2].map((n) => ({ name: `Изделие C132 ${n}`, passportDefaults: { elements: [element] }, deletedAt: null })));
    const made = await http().post('/api/passports').set(as(admin)).send({ name: 'Паспорт C132', passportCategory: 'TRN', elements: [String(element)] }).expect(201);
    const id = made.body.id;
    // Фикстура выданного паспорта: проверяем неизменность сохранённого снимка без автообновления черновика.
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(id) }, { $set: { status: 'issued' } });
    const saved = () => db().collection('productpassports').findOne({ _id: new Types.ObjectId(id) });
    const before = await saved();
    const index = before!.textSnapshot.rules.indexOf('Осмотреть крепления');
    expect(index).toBeGreaterThanOrEqual(0);
    return { id, element, saved, before, body: { field: 'rules', index, text: 'Проверить крепления перед занятием' } };
  }

  it('manager меняет только паспорт; справочник сохранён и promote запрещён', async () => {
    const f = await fixture();
    await http().patch(`/api/passports/${f.id}/snapshot-field`).set(as(manager)).send(f.body).expect(200);
    expect((await f.saved())!.textSnapshot.rules[f.body.index]).toBe(f.body.text);
    expect((await db().collection('dict_values').findOne({ _id: f.element }))!.usageRules).toBe('Осмотреть крепления');
    await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(manager)).send(f.body).expect(403);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(manager)).send(f.body).expect(403);
  });

  it('target показывает имя и число до записи; отмена не меняет источник и паспорт', async () => {
    const f = await fixture();
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    expect(target.body).toMatchObject({ affected: 2, shared: true, target: expect.stringContaining('Элемент C132'), token: expect.any(String) });
    expect(await f.saved()).toEqual(f.before);
    expect((await db().collection('dict_values').findOne({ _id: f.element }))!.usageRules).toBe('Осмотреть крепления');
  });

  it('director сохраняет введённый текст без PATCH; повтор и пересборка работают', async () => {
    const f = await fixture();
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...f.body, token: target.body.token }).expect(200);
    expect(await f.saved()).toEqual(f.before);
    expect((await db().collection('dict_values').findOne({ _id: f.element }))!.usageRules).toBe(f.body.text);
    const again = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...f.body, token: again.body.token }).expect(200);
    const rebuilt = await http().post(`/api/passports/${f.id}/snapshot`).set(as(manager)).expect(200);
    expect(rebuilt.body.textSnapshot.rules).toContain(f.body.text);
  });

  it('изменение источника после подтверждения даёт 409 без частичной правки паспорта', async () => {
    const f = await fixture();
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    await db().collection('dict_values').updateOne({ _id: f.element }, { $set: { usageRules: 'Конкурентная редакция' } });
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...f.body, token: target.body.token }).expect(409);
    expect(await f.saved()).toEqual(f.before);
    expect((await db().collection('dict_values').findOne({ _id: f.element }))!.usageRules).toBe('Конкурентная редакция');
  });

  it('старый снимок без refs не угадывает источник после смены строки', async () => {
    const f = await fixture();
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(f.id) }, { $unset: { 'textSnapshot.refs': '' } });
    await db().collection('dict_values').updateOne({ _id: f.element }, { $set: { usageRules: 'Другой текст источника' } });
    const before = await f.saved();
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send(f.body).expect(409);
    expect(await f.saved()).toEqual(before);
  });

  it('два разных сохранения одного источника: один успех, один 409, снимок не меняется', async () => {
    const f = await fixture();
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    const responses = await Promise.all(['Первый вариант', 'Второй вариант'].map((text) =>
      http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...f.body, text, token: target.body.token })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await f.saved()).toEqual(f.before);
  });

  it('пункт раздела: target и прямое сохранение без PATCH; устаревший token даёт 409', async () => {
    const f = await fixture();
    const section = f.before!.textSnapshot.sections.find((s: { items?: unknown[] }) => s.items?.length);
    expect(section).toBeDefined();
    const body = { sectionKey: section.key, itemKey: section.items[0].key, text: 'Новая редакция пункта C132' };
    const target = await http().post(`/api/passports/${f.id}/snapshot-item/target`).set(as(director)).send(body).expect(201);
    expect(target.body).toMatchObject({ target: expect.any(String), affected: expect.any(Number), token: expect.any(String) });
    expect(await f.saved()).toEqual(f.before);
    await http().post(`/api/passports/${f.id}/snapshot-item/promote`).set(as(manager)).send({ ...body, token: target.body.token }).expect(403);
    await http().post(`/api/passports/${f.id}/snapshot-item/promote`).set(as(director)).send({ ...body, token: target.body.token }).expect(200);
    expect(await f.saved()).toEqual(f.before);
    const texts = await http().get('/api/passports/template').query({ category: 'TRN' }).set(as(director)).expect(200);
    expect(JSON.stringify(texts.body)).toContain(body.text);
    await http().post(`/api/passports/${f.id}/snapshot-item/promote`).set(as(director)).send({ ...body, text: 'Устаревшая запись', token: target.body.token }).expect(409);
    expect(await f.saved()).toEqual(f.before);
    const fresh = await http().post(`/api/passports/${f.id}/snapshot-item/target`).set(as(director)).send(body).expect(201);
    await http().post(`/api/passports/${f.id}/snapshot-item/promote`).set(as(director)).send({ ...body, token: fresh.body.token }).expect(200);
    expect(await db().collection('passporttemplates').countDocuments({ category: 'TRN', isActive: true })).toBe(1);
  });

  it('параллельный promote пункта создаёт только одну активную версию категории', async () => {
    const f = await fixture();
    const section = f.before!.textSnapshot.sections.find((s: { items?: unknown[] }) => s.items?.length);
    const body = { sectionKey: section.key, itemKey: section.items[0].key, text: 'Параллельный пункт' };
    const target = await http().post(`/api/passports/${f.id}/snapshot-item/target`).set(as(director)).send(body).expect(201);
    const responses = await Promise.all(['Вариант А', 'Вариант Б'].map((text) => http().post(`/api/passports/${f.id}/snapshot-item/promote`).set(as(director)).send({ ...body, text, token: target.body.token })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db().collection('passporttemplates').countDocuments({ category: 'TRN', isActive: true })).toBe(1);
    expect(await f.saved()).toEqual(f.before);
  });

  it('ручная строка → promote → безопасная пересборка черновика сохраняет перенесённый текст', async () => {
    const f = await fixture();
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(f.id) }, { $set: { status: 'draft' } });
    await http().patch(`/api/passports/${f.id}/snapshot-field`).set(as(manager)).send(f.body).expect(200);
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(f.body).expect(201);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...f.body, token: target.body.token }).expect(200);
    // Правка влияющего на текст поля вызывает rebuildSafe, а не явную пересборку с удалением правок.
    const rebuilt = await http().patch(`/api/passports/${f.id}`).set(as(manager)).send({ name: 'Переименованный паспорт C132' }).expect(200);
    expect(rebuilt.body.textSnapshot.rules).toContain(f.body.text);
    expect((await db().collection('dict_values').findOne({ _id: f.element }))!.usageRules).toBe(f.body.text);
  });

  it('старый снимок: явный выбор связанного источника, неверный и устаревший ключи', async () => {
    const f = await fixture();
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(f.id) }, { $unset: { 'textSnapshot.refs': '' } });
    await db().collection('dict_values').updateOne({ _id: f.element }, { $set: { usageRules: 'Нынешний текст источника' } });
    const before = await f.saved();
    const sources = await http().post(`/api/passports/${f.id}/snapshot-field/sources`).set(as(director)).send({ field: 'rules', index: f.body.index }).expect(201);
    const selected = sources.body.items.find((x: { currentText: string }) => x.currentText === 'Нынешний текст источника');
    expect(selected).toMatchObject({ sourceKey: expect.any(String), label: expect.stringContaining('Элемент C132') });
    await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send({ ...f.body, sourceKey: 'несуществующий' }).expect(409);
    const body = { ...f.body, sourceKey: selected.sourceKey };
    const target = await http().post(`/api/passports/${f.id}/snapshot-field/target`).set(as(director)).send(body).expect(201);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...body, token: target.body.token }).expect(200);
    expect(await f.saved()).toEqual(before);
    await http().post(`/api/passports/${f.id}/snapshot-field/promote`).set(as(director)).send({ ...body, token: target.body.token }).expect(409);
    expect(await f.saved()).toEqual(before);
    if (process.env.C132_FIXTURE_OUT) writeFileSync(process.env.C132_FIXTURE_OUT, JSON.stringify({ ...before, id: f.id }, null, 2));
  });
});
