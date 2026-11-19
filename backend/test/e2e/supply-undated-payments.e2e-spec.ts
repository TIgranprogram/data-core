import request from 'supertest';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { SupplyInvoiceService } from '../../src/modules/supply/supply-invoice.service';
import { SupplyInvoicePaymentsService } from '../../src/modules/supply/supply-invoice-payments.service';
import { SupplyService } from '../../src/modules/supply/supply.service';

describe('C165: подтверждение оплаты без даты и исправление имени существующего PDF', () => {
  let ctx: TestContext, token: AuthTokens, payer: Types.ObjectId, supplier: Types.ObjectId;
  const db = () => ctx.connection.db!, http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access);
  const card = async (id: string) => (await http().get(`/api/supply/invoices/${id}`).set(auth()).expect(200)).body;
  const confirm = (id: string, body: object = {}) => http().post(`/api/supply/invoices/${id}/undated-payment`).set(auth()).send({ clientUid: 'confirmed', version: 0, reason: 'Бухгалтер подтвердил оплату; дата неизвестна', ...body });
  const revoke = (id: string, version: number, body: object = {}) => http().post(`/api/supply/invoices/${id}/undated-payment/revoke`).set(auth()).send({ clientUid: 'revoked', version, reason: 'Нужно уточнить первичный документ', ...body });
  const pay = (id: string, body: object = {}) => http().post(`/api/supply/invoices/${id}/payments`).set(auth()).send({ clientUid: 'dated', amount: 100, date: '2026-09-17', ...body });
  const fixture = async (extra: Record<string, unknown> = {}, count = 1) => {
    const id = new Types.ObjectId(), ids = Array.from({ length: count }, () => new Types.ObjectId());
    await db().collection('supplyinvoices').insertOne({ _id: id, no: 'C165-' + id, date: new Date('2026-09-01'), status: 'draft', amount: 100, payerCompanyId: payer, supplierId: supplier, version: 0, deletedAt: null, ...extra });
    await db().collection('supplyrequests').insertMany(ids.map(_id => ({ _id, invoiceId: id, title: 'C165 строка', qty: 1, priceHint: 100 / count, companyId: payer, supplierId: supplier, paid: false, status: 'ordered', invoiceDate: new Date('2026-09-01'), deletedAt: null })));
    return { id: String(id), ids };
  };
  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app);
    payer = new Types.ObjectId(); supplier = new Types.ObjectId();
    await db().collection('organizations').insertMany([{ _id: payer, name: 'C165 наша', inn: '9900000165', isOurCompany: true, deletedAt: null }, { _id: supplier, name: 'C165 поставщик', inn: '9900000265', deletedAt: null }]);
  });
  afterAll(async () => { await ctx?.cleanup(); });
  it('pending: нет ledger/paid/долга/прогноза; отдельная группа заполнения, reopen и фильтр', async () => {
    const x = await fixture();
    expect((await confirm(x.id).expect(200)).body).toMatchObject({ status: 'issued', paymentState: 'date_required', requiresPaymentDate: true, undatedConfirmedAmountRub: 100, paidAmount: null, balanceDue: null });
    await confirm(x.id).expect(200);
    await confirm(x.id, { reason: 'Иное основание' }).expect(409);
    const inv = await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(x.id) });
    expect(inv!.paymentAccountingVersion).toBeUndefined(); expect(inv!.paidAt).toBeUndefined();
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: inv!._id })).toBe(0);
    expect((await db().collection('supplyrequests').findOne({ _id: x.ids[0] }))!.paid).toBe(false);
    expect(await card(x.id)).toMatchObject({ paymentState: 'date_required', sourcePaidAmount: null, sourceBalance: null });
    const listed = (await http().get('/api/supply/invoices').set(auth()).query({ needsPaymentDate: '1' }).expect(200)).body;
    expect(listed.items.some((i: any) => i.id === x.id)).toBe(true);
    const finance = ctx.module.get(FinanceService) as any;
    for (const [from, to] of [['2026-09-01', '2026-09-30'], ['2026-11-01', '2026-11-30']]) {
      const facts = await finance.ops(from, to, [payer]);
      expect(facts.ops.some((i: any) => i.doc === 'C165-' + x.id || i.id === String(x.ids[0]))).toBe(false);
      expect((await finance.invoiceObligations(from, to, [payer])).invoices.some((i: any) => String(i._id) === x.id)).toBe(false);
    }
    const needs = (await http().get('/api/finance/needs-fill').set(auth()).expect(200)).body;
    expect(needs.needsPaymentDate.items.find((i: any) => i.invoiceId === x.id)).toMatchObject({ type: 'invoice', amount: 100, missing: ['дата оплаты'] });
    await http().post(`/api/supply/invoices/${x.id}/pay`).set(auth()).send({}).expect(409);
    await http().post(`/api/supply/invoices/${x.id}/unpay`).set(auth()).send({ confirm: true, reason: 'ошибка ввода' }).expect(409);
    for (const body of [{ amount: 100 }, { payerCompanyId: String(payer) }, { vatRate: 22 }]) await http().patch(`/api/supply/invoices/${x.id}`).set(auth()).send(body).expect(409);
    await http().patch(`/api/supply/invoices/${x.id}/lines/${x.ids[0]}`).set(auth()).send({ lineAmount: 100 }).expect(409);
    await http().patch(`/api/supply/requests/${x.ids[0]}`).set(auth()).send({ costCenter: 'workshop' }).expect(409);
    await http().delete(`/api/supply/invoices/${x.id}/lines/${x.ids[0]}`).set(auth()).expect(409);
    await http().post(`/api/supply/invoices/${x.id}/requests`).set(auth()).send({ requestIds: [String(x.ids[0])] }).expect(409);
    const other = await fixture();
    await http().post(`/api/supply/invoices/${x.id}/merge`).set(auth()).send({ targetId: other.id }).expect(409);
  });
  it('filldate: полный факт единожды, frozen article переживает архив, receipt не меняется', async () => {
    const article = new Types.ObjectId(), group = new Types.ObjectId();
    await db().collection('expensearticles').insertMany([{ _id: group, name: 'C165 группа', type: 'expense', nodeKind: 'group', selectable: false, deletedAt: null }, { _id: article, name: 'C165 историческая', parentId: group, type: 'expense', nodeKind: 'article', selectable: true, deletedAt: null }]);
    const x = await fixture({ receiptBoundaryAt: new Date() });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { articleId: article, status: 'received' } });
    const initial = (await confirm(x.id).expect(200)).body;
    await db().collection('expensearticles').updateOne({ _id: article }, { $set: { archivedAt: new Date(), name: 'Переименована' } });
    await pay(x.id, { amount: 50 }).expect(409);
    const body = { version: initial.version, payerCompanyId: String(payer) };
    const result = (await pay(x.id, body).expect(200)).body;
    await pay(x.id, body).expect(200); await confirm(x.id).expect(200);
    expect(result).toMatchObject({ status: 'paid', paymentState: 'paid', paidAmount: 100, balanceDue: 0, undatedPaymentEvidence: { state: 'resolved' } });
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
    expect(String(result.payments[0].allocations[0].articleId)).toBe(String(article));
    expect((await db().collection('supplyrequests').findOne({ _id: x.ids[0] }))!.status).toBe('received');
    expect((await (ctx.module.get(FinanceService) as any).ops('2026-09-01', '2026-09-30', [payer])).ops.filter((i: any) => i.doc === 'C165-' + x.id)).toHaveLength(1);
  });
  it('revoke: повтор старого confirm не активирует, новая команда с новой версией разрешена', async () => {
    const x = await fixture(); const a = (await confirm(x.id).expect(200)).body;
    const b = (await revoke(x.id, a.version).expect(200)).body;
    await revoke(x.id, a.version).expect(200); await confirm(x.id).expect(200);
    expect((await card(x.id)).undatedPaymentEvidence.state).toBe('revoked');
    await confirm(x.id, { clientUid: 'next-confirm', version: b.version }).expect(200);
  });
  it('полная приёмка сохраняет frozen аналитику; partial/изменение аналитики отказывают до stock-effect', async () => {
    const x = await fixture();
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { qty: 2 } });
    await confirm(x.id).expect(200);
    const receive = (body: object) => http().post(`/api/supply/requests/${x.ids[0]}/receive`).set(auth()).send(body);
    const before = await db().collection('stockmovements').countDocuments({ documentRef: 'SupplyRequest:' + x.ids[0] });
    await receive({ qty: 1, partial: true, clientUid: 'partial-block' }).expect(409);
    await receive({ toStock: false, costCenter: 'office', clientUid: 'dims-block' }).expect(409);
    expect(await db().collection('stockmovements').countDocuments({ documentRef: 'SupplyRequest:' + x.ids[0] })).toBe(before);
    expect((await db().collection('supplyrequests').findOne({ _id: x.ids[0] }))!.qty).toBe(2);
    await receive({ toStock: false, clientUid: 'full-receipt' }).expect(200);
    const line = await db().collection('supplyrequests').findOne({ _id: x.ids[0] });
    expect(line).toMatchObject({ status: 'received', qty: 2 }); expect(line!.costCenter).toBeUndefined();
    expect((await card(x.id)).paymentState).toBe('date_required');
    await pay(x.id).expect(200);
    expect((await db().collection('supplyrequests').findOne({ _id: x.ids[0] }))!.status).toBe('received');
  });
  it('отказ FX, legacy/voided истории, зеркал и несогласованных сумм без побочных записей', async () => {
    for (const extra of [{ currency: 'USD' }, { paidAt: new Date() }, { paymentSnapshot: { amount: 100 } }, { amount: 120 }, { status: 'paid' }]) {
      const x = await fixture(extra); const r = await confirm(x.id); expect([400, 409]).toContain(r.status);
      expect((await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(x.id) }))!.undatedPaymentEvidence).toBeUndefined();
    }
    const x = await fixture(); await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { paid: true } }); await confirm(x.id).expect(409);
    const y = await fixture(); await db().collection('supplyinvoicepayments').insertOne({ invoiceId: new Types.ObjectId(y.id), state: 'voided' }); await confirm(y.id).expect(409);
  });
  it('partial/scope/no-money не раскрывают evidence/основание/сумму', async () => {
    const visible = new Types.ObjectId(), hidden = new Types.ObjectId(), x = await fixture({}, 2), proof = new Types.ObjectId();
    await db().collection('photos').insertOne({ _id: proof, storageUrl: '/uploads/c165-proof.pdf', originalFilename: 'Подтверждение.pdf', mimeType: 'application/pdf', deletedAt: null });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { categoryId: visible } });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[1] }, { $set: { categoryId: hidden } }); await confirm(x.id, { fileIds: [String(proof)] }).expect(200);
    const whole = await card(x.id);
    expect(whole.undatedPaymentEvidence.files).toEqual([{ id: String(proof), name: 'Подтверждение.pdf', url: '/uploads/c165-proof.pdf', mime: 'application/pdf' }]);
    expect(whole.files).toEqual([]);
    const scope = { categoryIds: [String(visible)], noCategory: false, zones: [{ id: 'test', categoryIds: new Set([String(visible)]), includeIds: new Set<string>(), excludeIds: new Set<string>(), noCategory: false }] };
    const partial: any = await ctx.module.get(SupplyInvoiceService).get(x.id, scope);
    expect(partial.partial).toBe(true); expect(partial.undatedPaymentEvidence).toBeUndefined(); expect(partial.undatedPaymentCommands).toBeUndefined(); expect(partial.undatedConfirmedAmountRub).toBeNull();
    const needs = await ctx.module.get(FinanceService).needsFill(300, scope);
    expect(needs.needsPaymentDate.items.some(i => i.invoiceId === x.id)).toBe(false);
    const userId = new Types.ObjectId();
    await db().collection('users').insertOne({ _id: userId, username: 'C165-' + userId, role: 'user', isActive: true, permissions: [] });
    const signed = ctx.module.get(JwtService).sign({ sub: String(userId), username: 'C165-' + userId, role: 'user', version: 0 });
    const masked = (await http().get(`/api/supply/invoices/${x.id}`).set(authHeader(signed)).expect(200)).body;
    for (const k of ['undatedPaymentEvidence', 'undatedPaymentCommands', 'undatedConfirmedAmountRub', 'requiresPaymentDate']) expect(masked[k]).toBeUndefined();
    await http().post(`/api/supply/invoices/${x.id}/undated-payment/revoke`).set(authHeader(signed)).send({ clientUid: 'forbidden', version: 1, reason: 'Проверка прав' }).expect(403);
  });
  it('две даты/confirm race дают один факт; rollback не разрешает evidence', async () => {
    const x = await fixture(); const same = await Promise.all([confirm(x.id), confirm(x.id)]); expect(same.map(r => r.status)).toEqual([200, 200]);
    const v = (await card(x.id)).version;
    const results = await Promise.all([pay(x.id, { clientUid: 'date-a', version: v }), pay(x.id, { clientUid: 'date-b', version: v, date: '2026-09-18' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const y = await fixture(); await confirm(y.id).expect(200);
    const service = ctx.module.get(SupplyInvoicePaymentsService) as any;
    const spy = jest.spyOn(service, 'synchronize').mockRejectedValueOnce(new Error('C165 forced rollback'));
    try { await expect(service.add(y.id, { clientUid: 'rollback', amount: 100, date: '2026-09-17' })).rejects.toThrow('C165 forced rollback'); } finally { spy.mockRestore(); }
    expect((await card(y.id)).undatedPaymentEvidence.state).toBe('pending');
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(y.id) })).toBe(0);
  });
  it('revoke конкурирует с заполнением даты через один invoiceCAS', async () => {
    const x = await fixture(); const pending = (await confirm(x.id).expect(200)).body;
    const result = await Promise.all([revoke(x.id, pending.version), pay(x.id, { version: pending.version })]);
    expect(result.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = await card(x.id);
    const facts = await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) });
    expect(facts).toBe(saved.undatedPaymentEvidence.state === 'resolved' ? 1 : 0);
    await confirm(x.id).expect(200);
    expect((await card(x.id)).undatedPaymentEvidence.state).toBe(saved.undatedPaymentEvidence.state);
  });
  it('direct source recheck блокирует financial/status/analytics, если invoice присоединился после preGET', async () => {
    const service = ctx.module.get(SupplyService) as any, original = service.toFields.bind(service);
    for (const change of [{ priceHint: 200 }, { statusLabel: '💰 Оплачено' }, { costCenter: 'workshop' }]) {
      const x = await fixture();
      await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $unset: { invoiceId: '' } });
      const spy = jest.spyOn(service, 'toFields').mockImplementationOnce(async (dto: unknown) => {
        await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { invoiceId: new Types.ObjectId(x.id) } });
        await confirm(x.id).expect(200);
        return original(dto);
      });
      try { await expect(service.update(String(x.ids[0]), change)).rejects.toMatchObject({ status: change.priceHint ? 400 : 409 }); }
      finally { spy.mockRestore(); }
      const unchanged = await db().collection('supplyrequests').findOne({ _id: x.ids[0] });
      expect(unchanged).toMatchObject({ priceHint: 100, paid: false }); expect(unchanged!.costCenter).toBeUndefined();
      await pay(x.id).expect(200);
    }
  });
  it('P1 receive late-attach: fresh callback блокирует partial/явный разрез, полная сохраняет frozen basis', async () => {
    const service = ctx.module.get(SupplyService) as any, stock = service.stock;
    for (const scenario of [
      { body: { qty: 1, partial: true }, blocked: true, direct: false },
      { body: { costCenter: 'office' }, blocked: true, direct: false },
      { body: {}, blocked: false, direct: false },
      { body: { toStock: false, costCenter: 'office' }, blocked: true, direct: true },
      { body: { toStock: false }, blocked: false, direct: true },
    ]) {
      const x = await fixture(), material = new Types.ObjectId();
      await db().collection('materials').insertOne({ _id: material, name: 'C165 late-attach material', unit: 'шт', deletedAt: null });
      await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $unset: { invoiceId: '' }, $set: { qty: 2, unit: 'шт' } });
      const attachAndConfirm = async () => {
        const attached = (await http().post(`/api/supply/invoices/${x.id}/requests`).set(auth()).send({ requestIds: [String(x.ids[0])] }).expect(200)).body;
        await confirm(x.id, { version: attached.version }).expect(200);
      };
      let spy: jest.SpyInstance;
      if (scenario.direct) {
        const start = ctx.connection.startSession.bind(ctx.connection);
        spy = jest.spyOn(ctx.connection, 'startSession').mockImplementationOnce(async (...args) => { await attachAndConfirm(); return start(...args); });
      } else {
        spy = jest.spyOn(stock, 'createItem').mockImplementationOnce(async () => { await attachAndConfirm(); return { id: String(material) }; });
      }
      try {
        const receiving = service.receive(String(x.ids[0]), { ...scenario.body, clientUid: 'late-receive-' + x.id });
        if (scenario.blocked) await expect(receiving).rejects.toMatchObject({ status: 409 });
        else await receiving;
      } finally { spy.mockRestore(); }
      const source = await db().collection('supplyrequests').findOne({ _id: x.ids[0] });
      expect(source!.qty).toBe(2); expect(source!.costCenter).toBeUndefined(); expect(source!.costObject).toBeUndefined(); expect(source!.paid).toBe(false);
      expect(source!.status).toBe(scenario.blocked ? 'ordered' : 'received');
      expect(await db().collection('stockmovements').countDocuments({ documentRef: 'SupplyRequest:' + x.ids[0] })).toBe(!scenario.blocked && !scenario.direct ? 1 : 0);
      expect((await card(x.id)).undatedPaymentEvidence.state).toBe('pending');
      await pay(x.id).expect(200);
      expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
    }
  });
  it('P1 обратная гонка: attach не сбрасывает уже завершённую standalone приёмку', async () => {
    const x = await fixture(), invoices = ctx.module.get(SupplyInvoiceService) as any;
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $unset: { invoiceId: '' }, $set: { unit: 'шт' } });
    const touch = invoices.touchFinancialInvoice.bind(invoices);
    const spy = jest.spyOn(invoices, 'touchFinancialInvoice').mockImplementationOnce(async (...args: unknown[]) => {
      await ctx.module.get(SupplyService).receive(String(x.ids[0]), { toStock: false, clientUid: 'reverse-' + x.id });
      return touch(...args);
    });
    try { await expect(invoices.addRequests(x.id, [String(x.ids[0])])).rejects.toMatchObject({ status: 409 }); }
    finally { spy.mockRestore(); }
    const source = await db().collection('supplyrequests').findOne({ _id: x.ids[0] });
    expect(source!.status).toBe('received'); expect(source!.invoiceId).toBeUndefined();
    expect((await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(x.id) }))!.version).toBe(0);
  });
  it('filename: exact CP1251, CAS/replay/RBAC/whitelist без изменения файла и второго PhotoDoc', async () => {
    const id = new Types.ObjectId(), old = 'Ñ÷åò íà îïëàòó ¹ 24479 îò 17.09.2026.pdf', next = 'Счет на оплату № 24479 от 17.09.2026.pdf';
    const source = { _id: id, originalFilename: old, storageUrl: '/uploads/C165-existing.pdf', sizeBytes: 265700, mimeType: 'application/pdf', deletedAt: null };
    await db().collection('photos').insertOne(source);
    const repair = (body: object) => http().post(`/api/photos/${id}/repair-original-filename`).set(auth()).send(body);
    await repair({ expectedOriginalFilename: old, newOriginalFilename: 'произвольное.pdf' }).expect(400);
    await repair({ expectedOriginalFilename: old, newOriginalFilename: next, storageUrl: '/changed' }).expect(400);
    await repair({ expectedOriginalFilename: old, newOriginalFilename: '../bad.pdf' }).expect(400);
    await repair({ expectedOriginalFilename: old, newOriginalFilename: next }).expect(201);
    await repair({ expectedOriginalFilename: old, newOriginalFilename: next }).expect(201);
    const row = await db().collection('photos').findOne({ _id: id });
    expect(row).toMatchObject({ ...source, originalFilename: next });
    expect(await db().collection('photos').countDocuments({ storageUrl: source.storageUrl })).toBe(1);
    const wrong = Buffer.from('Другое.pdf', 'utf8').toString('latin1');
    await repair({ expectedOriginalFilename: wrong, newOriginalFilename: 'Другое.pdf' }).expect(409);
    const userId = new Types.ObjectId();
    await db().collection('users').insertOne({ _id: userId, username: 'C165-' + userId, role: 'user', isActive: true, permissions: [] });
    const signed = ctx.module.get(JwtService).sign({ sub: String(userId), username: 'C165-' + userId, role: 'user', version: 0 });
    await http().post(`/api/photos/${id}/repair-original-filename`).set(authHeader(signed)).send({ expectedOriginalFilename: old, newOriginalFilename: next }).expect(403);
  });
});
