import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** «Требуют заполнения» по категориям (TASKS ТЗ): группы, поле для подсветки, строка уходит после заполнения. */
describe('FillAudit', () => {
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

  it('счёт без направления затрат → группа exp-cost с полем costCenter; заполнили — ушла', async () => {
    const r = (await http().post('/api/supply/requests').set(auth()).send({ title: 'Профтруба 40×20', qty: 6, priceHint: 1200, invoiceDate: '2026-10-01', clientUid: 'fa-1' }).expect(201)).body;
    const rep = (await http().get('/api/fill-audit').set(auth()).expect(200)).body;
    const g = rep.groups.find((x: { key: string }) => x.key === 'exp-cost');
    expect(g).toMatchObject({ section: 'requests', field: 'costCenter', money: true, count: 1 });
    expect(g.items[0]).toMatchObject({ id: r.id });
    expect(rep.groups.find((x: { key: string }) => x.key === 'req-person')).toMatchObject({ field: 'requestedBy', title: 'Не указано, кто подал' });
    await http().patch(`/api/supply/requests/${r.id}`).set(auth()).send({ costCenter: 'workshop' }).expect(200);
    const only = (await http().get('/api/fill-audit').query({ only: 'exp-cost' }).set(auth()).expect(200)).body;
    expect(only.groups).toEqual([]);
  });
});
