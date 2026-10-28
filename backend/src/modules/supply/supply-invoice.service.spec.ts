import { ConflictException, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import { SupplyInvoiceService } from './supply-invoice.service';

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('SupplyInvoiceService: приход по счёту', () => {
  const invId = new Types.ObjectId();
  const mk = (status: string) => ({ _id: new Types.ObjectId(), num: 1, title: 'Болт', status, invoiceId: invId });
  let lines: Array<Record<string, unknown>>;
  let supply: { receive: jest.Mock };
  let svc: SupplyInvoiceService;

  beforeEach(() => {
    lines = [mk('ordered'), mk('received'), mk('ordered')];
    supply = { receive: jest.fn(async () => ({})) };
    const model = { findOne: jest.fn(() => chain({ _id: invId, status: 'paid', fileIds: [] })) };
    const requests = { find: jest.fn(() => chain(lines)) };
    const connection = { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } };
    svc = new SupplyInvoiceService(connection as never, model as never, requests as never, supply as never, {} as never, { toRoles: async () => 0 } as never);
    jest.spyOn(svc, 'get').mockResolvedValue({ id: String(invId) } as never);
  });

  it('по умолчанию принимает только неполученные', async () => {
    const r = await svc.receive(String(invId), undefined, 'u1');
    expect(supply.receive).toHaveBeenCalledTimes(2);
    expect(r.receivedCount).toBe(2);
  });
  it('повторный приём уже полученной — 409, ничего не принято', async () => {
    await expect(svc.receive(String(invId), [String(lines[1]._id), String(lines[0]._id)])).rejects.toBeInstanceOf(ConflictException);
    expect(supply.receive).not.toHaveBeenCalled();
  });
  it('всё получено — 409', async () => {
    lines.forEach((l) => { l.status = 'received'; });
    await expect(svc.receive(String(invId), undefined)).rejects.toThrow('уже приняты');
  });
  it('чужая заявка — 400', async () => {
    await expect(svc.receive(String(invId), [String(new Types.ObjectId())])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Деньги без задвоения (З14)', () => {
  it('календарь берёт расход только по заявкам, не по счетам', () => {
    const src = readFileSync(join(__dirname, '../finance/finance.service.ts'), 'utf8');
    expect(src).toContain("collection('supplyrequests')");
    expect(src).not.toContain('supplyinvoices');
  });
});
