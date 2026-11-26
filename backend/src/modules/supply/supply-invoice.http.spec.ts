import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { SupplyInvoiceService } from './supply-invoice.service';

/** HTTP-контракт контроллера и реальный get() счёта на моделях в памяти. */
describe('Снабжение: HTTP-контракт без Mongo', () => {
  let app: INestApplication;
  let invoices: SupplyInvoiceService;
  let lines: Array<Record<string, unknown>>;
  const invId = new Types.ObjectId();
  const lineId = new Types.ObjectId();
  const chain = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });
  const visibleRequest = {
    id: String(lineId), title: 'Труба', qty: 3,
    invoiceId: String(invId), invoiceNo: 'С-14', invoiceDeliveryDate: '2026-11-30T00:00:00.000Z',
  };
  const fullRequest = { ...visibleRequest, invoiceAmount: 75, invoiceNote: 'Примечание к счёту' };
  const invoice = { _id: invId, status: 'issued', amount: 75, note: 'Доставка через проходную', fileIds: [] };
  const supply = {
    list: () => ({ items: [fullRequest], total: 1, page: 1, limit: 20 }),
    assertRequest: async () => undefined,
    dropUnchanged: async (_id: string, body: object) => body,
    update: jest.fn(async (_id: string, body: object) => body),
    restoreNote: jest.fn(async (_id: string, body: { value: string | null }) => ({ notes: body.value })),
  };

  beforeAll(async () => {
    invoices = new SupplyInvoiceService(
      { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } } as never,
      { findOne: () => chain(invoice) } as never,
      {} as never,
      { byInvoice: async () => lines } as never,
      {} as never, {} as never,
    );
    const module = await Test.createTestingModule({
      controllers: [SupplyController],
      providers: [
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: SupplyService, useValue: supply },
        { provide: SupplierExcelService, useValue: {} },
        { provide: SupplierCatalogService, useValue: {} },
        { provide: SupplyInvoiceService, useValue: invoices },
      ],
    }).overrideGuard(ConfirmTokenGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.use((req: { headers: { 'x-test-role'?: string }; user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { id: String(new Types.ObjectId()), role: req.headers['x-test-role'] ?? 'admin' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  beforeEach(() => {
    lines = [{ _id: lineId, invoiceId: invId, qty: 3, priceHint: 75, status: 'ordered' }];
    supply.update.mockClear();
    supply.restoreNote.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it.each([['user', false], ['manager', true], ['accountant', true], ['director', true], ['admin', true]] as const)(
    'GET /supply/requests сохраняет пагинацию и применяет денежные права роли %s',
    async (role, canSeeMoney) => {
      const { body } = await request(app.getHttpServer()).get('/supply/requests').set('x-test-role', role).expect(200);
      expect(body).toEqual({ items: [canSeeMoney ? fullRequest : visibleRequest], total: 1, page: 1, limit: 20 });
    },
  );

  it.each(['2026-11-27', null])('PATCH заявки принимает плановую дату %s от менеджера', async neededBy => {
    await request(app.getHttpServer()).patch(`/supply/requests/${lineId}`).set('x-test-role', 'manager')
      .send({ neededBy }).expect(200);
    expect(supply.update).toHaveBeenCalledWith(String(lineId), { neededBy }, 'manager', expect.any(String));
  });

  it('PATCH заявки отклоняет несуществующую дату', async () => {
    await request(app.getHttpServer()).patch(`/supply/requests/${lineId}`).set('x-test-role', 'manager')
      .send({ neededBy: '2026-02-30' }).expect(400);
    expect(supply.update).not.toHaveBeenCalled();
  });

  it('возврат примечания доступен менеджеру с явным null и закрыт наблюдателю', async () => {
    const path = `/supply/requests/${lineId}/restore-note`;
    const change = { expected: 'Текущее', value: null };
    await request(app.getHttpServer()).patch(path).set('x-test-role', 'user').send(change).expect(403);
    await request(app.getHttpServer()).patch(path).set('x-test-role', 'manager').send(change).expect(200);
    expect(supply.restoreNote).toHaveBeenCalledTimes(1);
    expect(supply.restoreNote).toHaveBeenCalledWith(String(lineId), change, null);
  });

  it.each([{ value: null }, { expected: null }, { expected: null, value: null, qty: 7 }])(
    'возврат примечания требует оба поля и отклоняет другие поля: %j', async change => {
      await request(app.getHttpServer()).patch(`/supply/requests/${lineId}/restore-note`).set('x-test-role', 'manager')
        .send(change).expect(400);
      expect(supply.restoreNote).not.toHaveBeenCalled();
    },
  );

  it('GET /supply/invoices/:id возвращает unitPrice и lineAmount: unitPrice × qty = lineAmount', async () => {
    const { body } = await request(app.getHttpServer()).get(`/supply/invoices/${invId}`).expect(200);
    expect(body.requests[0]).toMatchObject({ qty: 3, priceHint: 75, unitPrice: 25, lineAmount: 75 });
    expect(body.requests[0].unitPrice * body.requests[0].qty).toBe(body.requests[0].lineAmount);
    expect(lines[0]).not.toHaveProperty('unitPrice');
  });

  it('GET /supply/invoices/:id скрывает сумму строки и сохраняет метаданные счёта для наблюдателя', async () => {
    const { body } = await request(app.getHttpServer()).get(`/supply/invoices/${invId}`).set('x-test-role', 'user').expect(200);
    expect(body).toMatchObject({ id: String(invId), note: invoice.note, requests: [{ qty: 3 }] });
    expect(body).not.toHaveProperty('amount');
    for (const key of ['lineAmount', 'unitPrice', 'priceHint']) expect(body.requests[0]).not.toHaveProperty(key);
  });

  it('GET округляет unitPrice до копеек, но не меняет сумму строки', async () => {
    lines[0].priceHint = 100;
    const { body } = await request(app.getHttpServer()).get(`/supply/invoices/${invId}`).expect(200);
    expect(body.requests[0]).toMatchObject({ qty: 3, unitPrice: 33.33, lineAmount: 100 });
  });

  it.each([0, -1])('GET при qty=%s не делит на ноль/отрицательное количество', async (qty) => {
    lines[0].qty = qty;
    const { body } = await request(app.getHttpServer()).get(`/supply/invoices/${invId}`).expect(200);
    expect(body.requests[0]).toMatchObject({ unitPrice: null, lineAmount: 75 });
  });

  it('PATCH строки принимает необязательный дробный qty с whitelist', async () => {
    jest.spyOn(invoices, 'assertWhole').mockResolvedValue();
    const update = jest.spyOn(invoices, 'updateLine').mockResolvedValue({ amount: 25 } as never);
    await request(app.getHttpServer()).patch(`/supply/invoices/${invId}/lines/${lineId}`)
      .send({ qty: 2.5, unitPrice: 10 }).expect(200);
    expect(update).toHaveBeenCalledWith(String(invId), String(lineId), { qty: 2.5, unitPrice: 10 }, expect.any(String), expect.objectContaining({ role: 'admin' }));
  });

  it.each([0, -1, '2'])('PATCH строки отклоняет qty=%s на уровне DTO', async (qty) => {
    const update = jest.spyOn(invoices, 'updateLine');
    await request(app.getHttpServer()).patch(`/supply/invoices/${invId}/lines/${lineId}`)
      .send({ qty, unitPrice: 10 }).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
});
