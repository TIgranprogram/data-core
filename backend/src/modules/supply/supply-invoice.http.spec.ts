import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { SupplyInvoiceService } from './supply-invoice.service';

/** Только HTTP-контракт контроллера и реальный get(); все модели в памяти, AppModule/БД не подключаются. */
describe('Счета: HTTP-контракт без Mongo', () => {
  let app: INestApplication;
  let invoices: SupplyInvoiceService;
  let lines: Array<Record<string, unknown>>;
  const invId = new Types.ObjectId();
  const lineId = new Types.ObjectId();
  const chain = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });

  beforeAll(async () => {
    invoices = new SupplyInvoiceService(
      { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } } as never,
      { findOne: () => chain({ _id: invId, status: 'issued', amount: 75, fileIds: [] }) } as never,
      {} as never,
      { byInvoice: async () => lines } as never,
      {} as never, {} as never,
    );
    const module = await Test.createTestingModule({
      controllers: [SupplyController],
      providers: [
        { provide: SupplyService, useValue: {} },
        { provide: SupplierExcelService, useValue: {} },
        { provide: SupplierCatalogService, useValue: {} },
        { provide: SupplyInvoiceService, useValue: invoices },
      ],
    }).overrideGuard(ConfirmTokenGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { id: String(new Types.ObjectId()), role: 'admin' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  beforeEach(() => {
    lines = [{ _id: lineId, invoiceId: invId, qty: 3, priceHint: 75, status: 'ordered' }];
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('GET /supply/invoices/:id возвращает unitPrice и lineAmount: unitPrice × qty = lineAmount', async () => {
    const { body } = await request(app.getHttpServer()).get(`/supply/invoices/${invId}`).expect(200);
    expect(body.requests[0]).toMatchObject({ qty: 3, priceHint: 75, unitPrice: 25, lineAmount: 75 });
    expect(body.requests[0].unitPrice * body.requests[0].qty).toBe(body.requests[0].lineAmount);
    expect(lines[0]).not.toHaveProperty('unitPrice');
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
