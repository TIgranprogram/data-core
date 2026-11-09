import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C054: признаки и условия паспортов — неизвестный код признака или ошибка в условии отклоняются при сохранении (400). */
describe('Паспорта: признаки и условия (C054)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('справочник: traits нормализуются, неизвестный признак — 400 с русским текстом', async () => {
    const ok = await http().post('/api/dicts/passportInstall').set(as(admin.access)).send({ name: 'Укладывается на основание', code: 'LAID', traits: 'freestanding, metal' }).expect(201);
    expect(ok.body.traits).toBe('metal, freestanding'); // порядок словаря, без повторов
    const bad = await http().post('/api/dicts/passportInstall').set(as(admin.access)).send({ name: 'Ошибка', code: 'BAD', traits: 'bolts, nonsense' }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('Неизвестный признак: nonsense');
  });

  it('дефект: when проверяется при записи', async () => {
    const ok = await http().post('/api/dicts/passportDefects').set(as(admin.access)).send({ name: 'Ослабление резьбы', code: 'LOOSE', period: 'ежемесячно', when: 'bolts' }).expect(201);
    expect(ok.body.when).toBe('bolts');
    for (const when of ['bolts|', '!', 'bolts nonsense', 'a||b']) {
      await http().post('/api/dicts/passportDefects').set(as(admin.access)).send({ name: `Плохой ${when}`, code: `X${Math.random().toString(36).slice(2, 7)}`, when }).expect(400);
    }
    await http().patch(`/api/dicts/passportDefects/${ok.body.id}`).set(as(admin.access)).send({ name: 'Ослабление резьбы', code: 'LOOSE', when: '!welds nope' }).expect(400);
  });

  it('паспорт: неизвестное соединение — 400; тексты: ids другой длины — 400', async () => {
    await http().post('/api/passports').set(as(admin.access)).send({ name: 'Решётка', joints: ['glue'] }).expect(400);
    const sections = [{ key: 'mounting', title: 'Монтаж', paragraphs: ['Первый', 'Второй'], ids: ['p1'] }];
    await http().put('/api/passports/texts').set(as(admin.access)).send({ category: 'BLG', sections }).expect(400);
    const badWhen = [{ key: 'mounting', title: 'Монтаж', paragraphs: ['Первый'], ids: ['p1'], when: ['wrongtrait'] }];
    await http().put('/api/passports/texts').set(as(admin.access)).send({ category: 'BLG', sections: badWhen }).expect(400);
  });
});
