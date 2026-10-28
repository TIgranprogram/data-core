import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { DesktopPairingKeyService } from '../../src/modules/desktop/desktop-pairing-key.service';

/**
 * SK-8d — сервер не отдаёт данные скрытых разделов (AppSectionGuard, кэш разделов роли);
 * деньги (8a6cb03, MoneyMask) — у роли без прав на деньги нет сумм, дат и статусов оплаты;
 * ШП-1 — PATCH /auth/me/prefs: null — сброс ключа, обычный сотрудник пишет свои.
 */
describe('Разделы роли на сервере (SK-8d) и деньги в заказах', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let keeperRoleId = '';
  let orderId = '';
  let paidLineId = '';
  let itemId = '';
  let reqId = '';

  const user = async (key: string, role: string) => {
    const username = `sec-${key}-${Date.now()}`;
    const u = (await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201)).body;
    uid[key] = u.id ?? u.user?.id;
    tok[key] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  };
  const role = async (label: string, baseRole: string, appSections?: string[]) =>
    (await http().post('/api/roles').set(as(admin.access)).send({ label, baseRole, ...(appSections ? { appSections } : {}) }).expect(201)).body;
  const keyFor = async (key: string) => {
    const svc = app.get(DesktopPairingKeyService);
    const me = (await http().get('/api/auth/me').set(as(tok[key])).expect(200)).body;
    const u = me.user ?? me;
    return (await svc.issue({ id: u.id, username: u.username, role: u.role, permissions: [], organizationId: null } as never, { label: `e2e-${key}`, apiBaseUrl: 'http://localhost' } as never)).apiKey as string;
  };
  const closed = (res: { status: number; body: { message?: unknown } }) => {
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/^Раздел «.+» для вашей роли закрыт$/);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const keeper = await role('Кладовщик', 'manager', ['stock', 'requests']);
    keeperRoleId = keeper.id;
    await user('keeper', keeper.name);
    await user('free', (await role('Без галочек', 'manager')).name);
    await user('dirStock', (await role('Директор склада', 'director', ['stock'])).name);
    await user('dirPay', (await role('Директор с ФОТ', 'director', ['stock', 'payroll'])).name);
    await user('manager', 'manager');
    await user('accountant', 'accountant');

    // данные: заказ с позициями (одна оплачена), позиция склада, заявка
    const t = as(admin.access);
    orderId = (await http().post('/api/salesorders').set(t).send({ orderNo: 'SEC-1', customer: 'ООО Разделы', shipDate: '10.01.2026' }).expect(201)).body.id;
    paidLineId = (await http().post('/api/incomes').set(t).send({ orderId, title: 'Скамья первая', qty: 2, unitPrice: 1000, shipDate: '10.01.2026', paidDate: '15.02.2026' }).expect(201)).body.id;
    await http().post('/api/incomes').set(t).send({ orderId, title: 'Урна вторая', qty: 1, unitPrice: 500, shipDate: '10.01.2026' }).expect(201);
    await http().post('/api/incomes').set(t).send({ orderId, title: 'Без суммы отгружено', qty: 1, shipDate: '10.01.2026' }).expect(201);
    itemId = (await http().post('/api/stock/items').set(t).send({ name: 'Болт разделов М8', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body.id;
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: itemId, qty: 50 }] }).expect(201);
    const draftOrder = (await http().post('/api/salesorders').set(t).send({ orderNo: 'SEC-2', customer: 'ООО Разделы' }).expect(201)).body.id;
    await http().post('/api/incomes').set(t).send({ orderId: draftOrder, title: 'Вазон черновик', qty: 1, unitPrice: 300 }).expect(201);
    reqId = (await http().post('/api/supply/requests').set(t).send({ title: 'Гайка разделов М8', qty: 10, salesOrderId: orderId, clientUid: 'sec-r1' }).expect(201)).body.id;
    await http().post('/api/dicts/persons/import').set(t).send({ names: ['Пётр Ставкин'] }).expect(200);
    const p = (await http().get('/api/dicts/persons').set(t).expect(200)).body.items.find((x: { name: string }) => x.name === 'Ставкин Пётр');
    await http().patch(`/api/dicts/persons/${p.id}`).set(t).send({ salaryKind: 'hour', salaryRate: '450' }).expect(200);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  describe('Кладовщик (manager + Склад, Заявки)', () => {
    it('склад и заявки — целиком: списки, карточки, приход по заявке, выдача под позицию заказа', async () => {
      const k = as(tok.keeper);
      await http().get('/api/stock/items').set(k).expect(200);
      await http().get(`/api/stock/items/${itemId}`).set(k).expect(200);
      await http().get('/api/supply/requests').set(k).expect(200);
      await http().get(`/api/supply/requests/${reqId}`).set(k).expect(200);
      await http().get('/api/supply/lookups').set(k).expect(200);
      await http().get('/api/incomes/lookups').set(k).expect(200);
      // новый поставщик из заявки (POST /partners открыт и для «Заявок»), список контрагентов — закрыт
      await http().post('/api/partners').set(k).send({ kind: 'supplier', name: 'ООО Поставщик кладовщика' }).expect(201);
      // поиск позиции склада из заявки — короткий список
      const lk = (await http().get('/api/stock/lookup').set(k).expect(200)).body;
      const row = lk.items.find((x: { id: string }) => x.id === itemId);
      expect(Object.keys(row).sort()).toEqual(['article', 'categoryName', 'free', 'id', 'materialId', 'name', 'quantity', 'unit']);
      // «Приход» по заявке
      const got = (await http().post(`/api/supply/requests/${reqId}/receive`).set(k).send({ qty: 10 }).expect(200)).body;
      expect(got.status).toBe('received');
      // выдача под позицию заказа: поиск заказа и позиций — без денег
      const so = (await http().get('/api/salesorders/lookup').query({ filter: 'all', lines: '1' }).set(k).expect(200)).body;
      const o = so.items.find((x: { id: string }) => x.id === orderId);
      expect(Object.keys(o).sort()).toEqual(['customer', 'id', 'lines', 'orderNo', 'productionNo', 'shipDate', 'stage', 'title']);
      expect(Object.keys(o.lines[0]).sort()).toEqual(['id', 'lineNo', 'productId', 'qty', 'title']);
      const ll = (await http().get(`/api/salesorders/${orderId}/lines-lookup`).set(k).expect(200)).body;
      const lines = Array.isArray(ll) ? ll : ll.items;
      expect(lines.length).toBe(3);
      expect(JSON.stringify(lines)).not.toMatch(/unitPrice|amount|paidDate|reportDate|"paid"|awaiting/);
      await http().post('/api/stock/batch').set(k)
        .send({ type: 'out', salesOrderId: orderId, salesOrderLineId: lines[0].id, lines: [{ materialId: itemId, qty: 2 }] }).expect(201);
      expect((await http().get(`/api/stock/items/${itemId}`).set(k).expect(200)).body.quantity).toBe(48);
    });

    it('закрытые разделы — 403 «Раздел … закрыт»: заказы, карточка заказа, деньги, паспорта, контрагенты, позиции', async () => {
      const k = as(tok.keeper);
      for (const url of ['/api/salesorders', `/api/salesorders/${orderId}`,
        '/api/passports', '/api/partners', '/api/incomes', `/api/incomes/${paidLineId}`, '/api/showcase']) {
        const r = await http().get(url).set(k);
        expect({ url, status: r.status, message: r.body.message }).toEqual({ url, status: 403, message: expect.stringMatching(/^Раздел «.+» для вашей роли закрыт$/) });
      }
      // деньги менеджерской роли закрыты правами (RolesGuard); у директора со Складом — разделом
      await http().get('/api/finance/summary').set(k).expect(403);
      for (const url of ['/api/finance/summary', '/api/finance/cashflow', '/api/finance/forecast']) closed(await http().get(url).set(as(tok.dirStock)));
      await http().get('/api/finance/summary').set(as(tok.accountant)).expect(200);
      closed(await http().get('/api/audit-logs/record').query({ entityType: 'SalesOrder', entityId: orderId }).set(k));
      await http().get('/api/audit-logs/record').query({ entityType: 'Material', entityId: itemId }).set(k).expect(200);
    });

    it('fill-audit — только группы Склада и Заявок; only=<закрытый> — пусто', async () => {
      const rep = (await http().get('/api/fill-audit').set(as(tok.keeper)).expect(200)).body;
      for (const g of rep.groups) expect(['stock', 'requests']).toContain(g.section);
      expect(rep.total).toBe(rep.groups.reduce((s: number, g: { count: number }) => s + g.count, 0));
      const so = (await http().get('/api/fill-audit').query({ only: 'so-ship' }).set(as(tok.keeper)).expect(200)).body;
      expect(so).toMatchObject({ total: 0, groups: [] });
      await http().post('/api/salesorders').set(as(admin.access)).send({ orderNo: 'SEC-NOSHIP' }).expect(201);
      const full = (await http().get('/api/fill-audit').set(as(tok.free)).expect(200)).body;
      expect(full.groups.some((g: { section: string }) => g.section === 'salesorders')).toBe(true);
    });

    it('/dicts/persons: закрыт ФОТ — без salaryKind/salaryRate (и в форме), открыт — с оплатой', async () => {
      for (const key of ['keeper', 'dirStock']) {
        const r = (await http().get('/api/dicts/persons').set(as(tok[key])).expect(200)).body;
        const p = r.items.find((x: { name: string }) => x.name === 'Ставкин Пётр');
        expect(p.salaryKind).toBeUndefined();
        expect(p.salaryRate).toBeUndefined();
        expect(JSON.stringify(r.dict ?? {})).not.toMatch(/salaryKind|salaryRate/);
        const one = (await http().get(`/api/dicts/persons/${p.id}`).set(as(tok[key])).expect(200)).body;
        expect(one.salaryKind).toBeUndefined();
        expect(one.salaryRate).toBeUndefined();
      }
      const open = (await http().get('/api/dicts/persons').set(as(tok.dirPay)).expect(200)).body.items.find((x: { name: string }) => x.name === 'Ставкин Пётр');
      expect(open).toMatchObject({ salaryKind: 'hour', salaryRate: 450 });
    });

    it('/audit-logs/app (директор со Складом): только типы открытых разделов; закрытый тип — 400', async () => {
      const d = as(tok.dirStock);
      const all = (await http().get('/api/audit-logs/app').query({ limit: 200 }).set(d).expect(200)).body;
      for (const x of all.items) expect(['Material', 'StockMovement', 'DictItem']).toContain(x.entityType);
      await http().get('/api/audit-logs/app').query({ entityType: 'SalesOrder' }).set(d).expect(400);
      await http().get('/api/audit-logs/app').query({ entityType: 'Income' }).set(d).expect(400);
      await http().get('/api/audit-logs/app/users').set(d).expect(200);
      const adm = (await http().get('/api/audit-logs/app').query({ entityType: 'SalesOrder' }).set(as(admin.access)).expect(200)).body;
      expect(adm.items.length).toBeGreaterThan(0);
    });

    it('смена галочек действует со следующего запроса, без перевхода; снятие всех — как раньше', async () => {
      const k = as(tok.keeper);
      closed(await http().get('/api/salesorders').set(k));
      await http().patch(`/api/roles/${keeperRoleId}`).set(as(admin.access)).send({ appSections: ['stock', 'requests', 'salesorders'] }).expect(200);
      await http().get('/api/salesorders').set(k).expect(200);
      await http().patch(`/api/roles/${keeperRoleId}`).set(as(admin.access)).send({ appSections: ['requests'] }).expect(200);
      closed(await http().get('/api/stock/items').set(k));
      await http().get('/api/stock/lookup').set(k).expect(200); // короткий поиск для «Заявок» остаётся
      await http().patch(`/api/roles/${keeperRoleId}`).set(as(admin.access)).send({ appSections: [] }).expect(200);
      await http().get('/api/salesorders').set(k).expect(200);
      await http().get('/api/finance/summary').set(k).expect(403); // права на деньги не менялись
      await http().patch(`/api/roles/${keeperRoleId}`).set(as(admin.access)).send({ appSections: ['stock', 'requests'] }).expect(200);
      closed(await http().get('/api/salesorders').set(k));
    });
  });

  it('роль без галочек и встроенный менеджер — как раньше; admin — всё', async () => {
    for (const key of ['free', 'manager']) {
      for (const url of ['/api/salesorders', `/api/salesorders/${orderId}`, '/api/partners', '/api/incomes', '/api/passports', '/api/stock/items']) {
        await http().get(url).set(as(tok[key])).expect(200);
      }
    }
    for (const url of ['/api/salesorders', '/api/finance/summary', '/api/passports', '/api/partners', '/api/incomes', '/api/audit-logs/app']) {
      await http().get(url).set(as(admin.access)).expect(200);
    }
    // карточка заказа у роли без ограничений — с заявками и движениями склада
    const card = (await http().get(`/api/salesorders/${orderId}`).set(as(tok.free)).expect(200)).body;
    expect(card.supplyRequests.length).toBe(1);
    expect(card.stockMovements.length).toBeGreaterThan(0);
  });

  it('карточка заказа у роли с Заказами без Склада и Заявок — без заявок и движений', async () => {
    const r = await role('Только заказы', 'manager', ['salesorders']);
    await user('ordersOnly', r.name);
    const card = (await http().get(`/api/salesorders/${orderId}`).set(as(tok.ordersOnly)).expect(200)).body;
    expect(card.supplyRequests).toEqual([]);
    expect(card.stockMovements).toEqual([]);
    expect(card.issuedByLine).toEqual([]);
    closed(await http().get('/api/stock/items').set(as(tok.ordersOnly)));
  });

  it('ключ kppd_: владелец со встроенной ролью — как раньше; со своей ролью с галочками — ограничен', async () => {
    const mk = await keyFor('manager');
    await http().get('/api/salesorders').set(as(mk)).expect(200);
    await http().get('/api/incomes').set(as(mk)).expect(200);
    const kk = await keyFor('keeper');
    await http().get('/api/stock/items').set(as(kk)).expect(200);
    closed(await http().get('/api/salesorders').set(as(kk)));
    closed(await http().get('/api/incomes').set(as(kk)));
  });

  describe('деньги: роль без прав на деньги не узнаёт сумм и оплаты', () => {
    const MONEY = /"(amount|amountManual|unitPrice|paidAmount|sum|paidDate|reportDate|priceHint)"\s*:/;
    const PAY = /"(paid|awaiting|noamount)"|Оплач|оплач/;

    it('карточка заказа, список заказов: без сумм, дат оплат; статус позиции — draft / shipped', async () => {
      for (const key of ['manager', 'free']) {
        const card = (await http().get(`/api/salesorders/${orderId}`).set(as(tok[key])).expect(200)).body;
        const { supplyRequests: _s, ...rest } = card;
        expect(JSON.stringify(rest)).not.toMatch(MONEY);
        expect(JSON.stringify(rest)).not.toMatch(PAY);
        for (const l of card.lines) expect(['draft', 'shipped']).toContain(l.status);
        expect(card.lines.map((l: { status: string }) => l.status)).toEqual(['shipped', 'shipped', 'shipped']);
        const list = (await http().get('/api/salesorders').set(as(tok[key])).expect(200)).body;
        expect(JSON.stringify(list)).not.toMatch(MONEY);
      }
    });

    it('/incomes список и карточка: без сумм, дат оплат, статусы и counts без paid/awaiting/noamount', async () => {
      const m = as(tok.manager);
      const list = (await http().get('/api/incomes').query({ orderId }).set(m).expect(200)).body;
      expect(JSON.stringify(list)).not.toMatch(MONEY);
      expect(JSON.stringify(list)).not.toMatch(PAY);
      expect(Object.keys(list.counts).sort()).toEqual(['all', 'draft', 'shipped']);
      expect(list.counts).toEqual({ all: 3, draft: 0, shipped: 3 });
      const all = (await http().get('/api/incomes').query({ search: 'Разделы' }).set(m).expect(200)).body;
      expect(all.counts).toEqual({ all: 4, draft: 1, shipped: 3 });
      const one = (await http().get(`/api/incomes/${paidLineId}`).set(m).expect(200)).body;
      expect(JSON.stringify(one)).not.toMatch(MONEY);
      expect(one.status).toBe('shipped');
    });

    it('?status=paid / awaiting / noamount не отличают оплату от отгрузки', async () => {
      const m = as(tok.manager);
      const ids = async (q: Record<string, string>) =>
        ((await http().get('/api/incomes').query({ orderId, ...q }).set(m).expect(200)).body.items as Array<{ id: string }>).map((x) => x.id).sort();
      const shipped = await ids({ status: 'shipped' });
      expect(shipped).toHaveLength(3);
      for (const status of ['paid', 'awaiting', 'noamount']) expect(await ids({ status })).toEqual(shipped);
    });

    it('?sort=-paidDate / -reportDate / amount не применяются (порядок как без сортировки)', async () => {
      const m = as(tok.manager);
      const order = async (q: Record<string, string>) =>
        ((await http().get('/api/incomes').query({ orderId, ...q }).set(m).expect(200)).body.items as Array<{ id: string }>).map((x) => x.id);
      const base = await order({});
      for (const sort of ['-paidDate', 'paidDate', '-reportDate', 'amount', '-unitPrice']) expect(await order({ sort })).toEqual(base);
    });

    it('порядок по умолчанию не выдаёт оплату: одна дата отгрузки — новые сверху, оплаченная не всплывает', async () => {
      // сортировка по умолчанию у /incomes — -reportDate (= дата оплаты ?? отгрузки): оплаченная позиция встаёт первой
      const items = (await http().get('/api/incomes').query({ orderId }).set(as(tok.manager)).expect(200)).body.items as Array<{ title: string }>;
      expect(items.map((x) => x.title)).toEqual(['Без суммы отгружено', 'Урна вторая', 'Скамья первая']);
    });

    it('?from&to (период) по позициям не выдаёт оплату: отгружено 10.01, оплата 15.02', async () => {
      const m = as(tok.manager);
      const titles = async (q: Record<string, string>) =>
        ((await http().get('/api/incomes').query({ orderId, ...q }).set(m).expect(200)).body.items as Array<{ title: string }>).map((x) => x.title).sort();
      // если период фильтрует по дате оплаты (reportDate = paidDate ?? shipDate), оплаченная позиция «пропадёт» из дня отгрузки
      const shipDay = await titles({ from: '2026-01-10', to: '2026-01-10' });
      const payDay = await titles({ from: '2026-02-15', to: '2026-02-15' });
      expect({ shipDay, payDay }).toEqual({
        shipDay: ['Без суммы отгружено', 'Скамья первая', 'Урна вторая'],
        payDay: [],
      });
    });

    it('история позиции (/audit-logs/record Income): без даты оплаты и сумм', async () => {
      await http().patch(`/api/incomes/${paidLineId}`).set(as(admin.access)).send({ paidDate: '20.02.2026', qty: 3 }).expect(200);
      const h = (await http().get('/api/audit-logs/record').query({ entityType: 'Income', entityId: paidLineId }).set(as(tok.manager)).expect(200)).body;
      const fields = h.items.flatMap((x: { changes?: Array<{ field: string }> }) => (x.changes ?? []).map((c) => c.field));
      expect(fields).toContain('qty');
      expect(h.items.flatMap((x: { changes?: Array<{ field: string }> }) => (x.changes ?? []).filter((c) => ['paidDate', 'reportDate', 'amount', 'unitPrice', 'status'].includes(c.field)))).toEqual([]);
    });

    it('карточка заказчика: заказы без сумм и оплаты', async () => {
      const c = (await http().get(`/api/partners/${encodeURIComponent('c:ООО Разделы')}`).set(as(tok.manager)).expect(200)).body;
      expect(c.related.length).toBe(2);
      expect(JSON.stringify(c)).not.toMatch(MONEY);
    });

    it('бухгалтер видит всё: суммы, даты оплат, статусы paid / awaiting / noamount', async () => {
      const a = as(tok.accountant);
      const card = (await http().get(`/api/salesorders/${orderId}`).set(a).expect(200)).body;
      expect(card.amount).toBe(3500); // 3×1000 (qty поправлен в тесте истории) + 500
      expect(card.paidAmount).toBeGreaterThan(0);
      const list = (await http().get('/api/incomes').query({ orderId }).set(a).expect(200)).body;
      expect(list.counts).toMatchObject({ paid: 1, awaiting: 1, noamount: 1, draft: 0 });
      expect(list.items.find((x: { id: string }) => x.id === paidLineId)).toMatchObject({ status: 'paid', unitPrice: 1000 });
      expect(list.items.find((x: { id: string }) => x.id === paidLineId).paidDate).toBeTruthy();
      expect((await http().get('/api/incomes').query({ orderId, status: 'paid' }).set(a).expect(200)).body.total).toBe(1);
    });
  });

  describe('ШП-1 — PATCH /auth/me/prefs', () => {
    it('сотрудник со своей ролью пишет свои; границы включительно; null — сброс ключа', async () => {
      const k = as(tok.keeper);
      expect((await http().patch('/api/auth/me/prefs').set(k).send({ sidebarW: 200, detailW: 1100, filterW: 700 }).expect(200)).body.uiPrefs)
        .toEqual({ sidebarW: 200, detailW: 1100, filterW: 700 });
      expect((await http().patch('/api/auth/me/prefs').set(k).send({ sidebarW: 360, detailW: 360, filterW: 280 }).expect(200)).body.uiPrefs)
        .toEqual({ sidebarW: 360, detailW: 360, filterW: 280 });
      expect((await http().patch('/api/auth/me/prefs').set(k).send({ detailW: null }).expect(200)).body.uiPrefs)
        .toEqual({ sidebarW: 360, filterW: 280 });
      const me = (await http().get('/api/auth/me').set(k).expect(200)).body;
      expect(me.uiPrefs ?? me.user?.uiPrefs).toEqual({ sidebarW: 360, filterW: 280 });
      // чужие настройки не тронуты
      const other = (await http().get('/api/auth/me').set(as(tok.manager)).expect(200)).body;
      expect(other.uiPrefs ?? other.user?.uiPrefs).toEqual({});
    });

    it('ключ kppd_ сотрудника — 403 с понятным текстом', async () => {
      const kk = await keyFor('manager');
      const r = await http().patch('/api/auth/me/prefs').set(as(kk)).send({ detailW: 700 }).expect(403);
      expect(String(r.body.message)).toMatch(/только из входа в приложение/);
    });
  });
});
