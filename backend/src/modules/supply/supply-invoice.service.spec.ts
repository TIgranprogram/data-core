import { BadRequestException, ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import { SupplyInvoiceService } from './supply-invoice.service';

type Doc = Record<string, unknown>;

/** Заглушка цепочки Mongoose: sort/skip/limit/lean/select/session/setOptions → сама цепочка, exec → результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'select', 'session', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

const connection = () => ({
  startSession: async () => ({ withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined }),
  db: { collection: () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }), countDocuments: async () => 0 }) },
});

/** Фейковый model счетов: хранит документы, применяет $set/$unset/$inc/$push. */
function fakeModel(invoices: Record<string, Doc>) {
  const updates: Array<[unknown, unknown]> = [];
  const api = {
    updates,
    findOne: jest.fn((f: Doc) => chain(invoices[String(f._id)] ? { ...invoices[String(f._id)] } : null)),
    find: jest.fn(() => chain(Object.values(invoices).filter((i) => !i.deletedAt))),
    updateOne: jest.fn((f: Doc, u: Doc) => {
      updates.push([f, u]);
      const doc = invoices[String(f._id)];
      if (doc) {
        if (u.$set) Object.assign(doc, u.$set);
        if (u.$unset) for (const k of Object.keys(u.$unset as Doc)) delete doc[k];
        if (u.$inc) for (const [k, v] of Object.entries(u.$inc as Doc)) doc[k] = (Number(doc[k]) || 0) + Number(v);
        if (u.$push) for (const [k, v] of Object.entries(u.$push as Doc)) (doc[k] = (doc[k] as unknown[]) ?? []).push(v);
      }
      return chain({ matchedCount: 1 });
    }),
    countDocuments: jest.fn(() => chain(0)),
  };
  return api;
}

/** Фейковый model заявок (строк): find учитывает invoiceId и _id.$in, updateOne меняет строку. */
function fakeRequests(lines: Doc[]) {
  const updates: Array<[unknown, unknown]> = [];
  const api = {
    updates,
    find: jest.fn((f: Doc) => {
      let out = lines;
      if (f.invoiceId) out = out.filter((l) => String(l.invoiceId) === String(f.invoiceId));
      const range = f._id as { $in?: unknown[] } | undefined;
      if (range?.$in) out = out.filter((l) => range.$in!.map(String).includes(String(l._id)));
      return chain(out.filter((l) => !l.deletedAt && l.status !== 'cancelled').map((l) => ({ ...l })));
    }),
    findOne: jest.fn((f: Doc) => chain(lines.find((l) => String(l._id) === String(f._id) && (!f.invoiceId || String(l.invoiceId) === String(f.invoiceId))) ?? null)),
    updateOne: jest.fn((f: Doc, u: Doc) => {
      updates.push([f, u]);
      const l = lines.find((x) => String(x._id) === String(f._id));
      if (l) {
        if (u.$set) Object.assign(l, u.$set);
        if (u.$unset) for (const k of Object.keys(u.$unset as Doc)) delete l[k];
      }
      return chain({});
    }),
    updateMany: jest.fn((f: Doc, u: Doc) => {
      updates.push([f, u]);
      const range = f._id as { $in?: unknown[] } | undefined;
      for (const l of lines) {
        const hit = range?.$in ? range.$in.map(String).includes(String(l._id)) : true;
        if (hit && u.$set) Object.assign(l, u.$set);
        if (hit && u.$unset) for (const k of Object.keys(u.$unset as Doc)) delete l[k];
      }
      return chain({});
    }),
    countDocuments: jest.fn(() => chain(0)),
  };
  return api;
}

function makeSvc(opts: { invoices: Record<string, Doc>; lines?: Doc[]; prices?: { record: jest.Mock }; audit?: { log: jest.Mock } }) {
  const model = fakeModel(opts.invoices);
  const requests = fakeRequests(opts.lines ?? []);
  const prices = opts.prices ?? { record: jest.fn(async () => true) };
  const svc = new SupplyInvoiceService(
    connection() as never, model as never, requests as never, {} as never, prices as never, { toRoles: async () => undefined } as never, opts.audit as never,
  );
  jest.spyOn(svc, 'get').mockImplementation(async (id: string) => ({ id, amount: opts.invoices[id]?.amount }) as never);
  return { svc, model, requests, prices };
}

describe('SupplyInvoiceService: приход по счёту', () => {
  const invId = new Types.ObjectId();
  const mk = (status: string) => ({ _id: new Types.ObjectId(), num: 1, title: 'Болт', status, invoiceId: invId });
  let lines: Doc[];
  let supply: { receive: jest.Mock };
  let svc: SupplyInvoiceService;

  beforeEach(() => {
    lines = [mk('ordered'), mk('received'), mk('ordered')];
    supply = { receive: jest.fn(async () => ({})) };
    const model = { findOne: jest.fn(() => chain({ _id: invId, status: 'paid', fileIds: [] })) };
    const requests = { find: jest.fn(() => chain(lines)) };
    const conn = { db: { collection: () => ({ find: () => ({ toArray: async () => [] }), countDocuments: async () => 0 }) } };
    svc = new SupplyInvoiceService(conn as never, model as never, requests as never, supply as never, {} as never, { toRoles: async () => 0 } as never);
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
  it('приход берёт текущую цену строки и не меняет её', async () => {
    const line = lines[0];
    await svc.receive(String(invId), [String(line._id)], 'u1');
    expect(supply.receive).toHaveBeenCalledWith(String(line._id), expect.objectContaining({ clientUid: expect.stringContaining(String(line._id)) }), 'u1');
    expect(line.priceHint).toBeUndefined();
  });
});

describe('Деньги без задвоения (З14)', () => {
  it('календарь использует payment snapshot, сохраняет legacy fallback и исключает дубли', () => {
    const src = readFileSync(join(__dirname, '../finance/finance.service.ts'), 'utf8');
    expect(src).toContain("collection('supplyrequests')");
    expect(src).toContain("collection('supplyinvoices')");
    expect(src).toContain('paymentSnapshot');
    expect(src).toContain('snapshotInvoiceIds.has(String(r.invoiceId))');
  });
});

describe('Счета: дубль номера — 409, без автоматической склейки', () => {
  const sup = new Types.ObjectId();
  const cur = () => ({ _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 100, fileIds: [new Types.ObjectId()], no: undefined as string | undefined });
  const dupDoc = (o: Doc = {}) => ({ _id: new Types.ObjectId(), supplierId: sup, no: ' №41125', status: 'draft', amount: 50, fileIds: [], date: new Date('2026-10-01'), ...o });

  it('дубль № → ConflictException с id существующего, данные не меняются', async () => {
    const mine = cur();
    const dup = dupDoc();
    const { svc, model, requests } = makeSvc({ invoices: { [String(mine._id)]: mine, [String(dup._id)]: dup } });
    model.find.mockReturnValue(chain([dup]));
    const err = await svc.update(String(mine._id), { no: '41125' } as never).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ existingInvoiceId: String(dup._id) });
    expect(model.updates).toHaveLength(0);
    expect(requests.updates).toHaveLength(0);
  });

  it('другой № — счёт правится, ничего не склеивается', async () => {
    const mine = cur();
    const { svc, model } = makeSvc({ invoices: { [String(mine._id)]: mine } });
    model.find.mockReturnValue(chain([dupDoc({ no: '999' })]));
    const r = await svc.update(String(mine._id), { no: '41125' } as never) as unknown as { id: string };
    expect(r.id).toBe(String(mine._id));
    expect(model.updates.some(([, u]) => Boolean((u as Doc).$set && ((u as Doc).$set as Doc).deletedAt))).toBe(false);
  });

  it('дубль № с причиной — остаётся отдельным счётом, без склейки', async () => {
    const mine = cur();
    const dup = dupDoc();
    const { svc, model } = makeSvc({ invoices: { [String(mine._id)]: mine, [String(dup._id)]: dup } });
    model.find.mockReturnValue(chain([dup]));
    await svc.update(String(mine._id), { no: '41125', duplicateReason: 'отдельная поставка' } as never);
    const upd = model.updates.find(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).duplicateReason !== undefined);
    expect((upd![1] as Doc).$set).toMatchObject({ duplicateOf: dup._id, duplicateReason: 'отдельная поставка' });
    expect(model.updates.some(([, u]) => Boolean((u as Doc).$set && ((u as Doc).$set as Doc).deletedAt))).toBe(false);
  });

  it('поиск дубля — только того же поставщика и не отменённых', async () => {
    const mine = cur();
    const { svc, model } = makeSvc({ invoices: { [String(mine._id)]: mine } });
    model.find.mockReturnValue(chain([]));
    await svc.update(String(mine._id), { no: '41125' } as never);
    expect(model.find).toHaveBeenCalledWith({ supplierId: sup, deletedAt: null, status: { $ne: 'cancelled' }, _id: { $ne: mine._id } });
  });
});

describe('Счета: явное объединение', () => {
  const sup = new Types.ObjectId();
  const mkLines = (invoiceId: Types.ObjectId, nums: number[], extra: Doc = {}) => nums.map((p, i) => ({
    _id: new Types.ObjectId(), num: i + 1, title: `Позиция ${i + 1}`, qty: 1, priceHint: p, status: 'ordered', invoiceId, ...extra,
  }));

  it('preview показывает дубли и итоговые суммы, ничего не пишет', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', amount: 30, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'B', amount: 5, fileIds: [] };
    const same = new Types.ObjectId();
    const srcLines = [...mkLines(src._id, [10, 20]), { ...mkLines(src._id, [7])[0], materialId: same, qty: 2 }];
    const dstLines = [{ ...mkLines(dst._id, [7])[0], materialId: same, qty: 2 }];
    const { svc, model } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines: [...srcLines, ...dstLines] });
    const p = await svc.mergePreview(String(src._id), String(dst._id));
    expect(p.duplicates).toBe(1);
    expect(p.strategies).toEqual(['append', 'mergeSameRequest', 'replaceLines']);
    expect(p.resultAmount.append).toBe(44);
    expect(p.resultAmount.replaceLines).toBe(37);
    expect(model.updates).toHaveLength(0);
  });

  it('append: строки переехали, amount = сумма строк, журнал и мягкое удаление источника', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', amount: 30, fileIds: [new Types.ObjectId()] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'B', amount: 5, fileIds: [] };
    const srcLines = mkLines(src._id, [10, 20]);
    const dstLines = mkLines(dst._id, [5]);
    const { svc, model, requests } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines: [...srcLines, ...dstLines] });
    const r = await svc.merge(String(src._id), String(dst._id), 'append', String(new Types.ObjectId()));
    expect(r).toMatchObject({ targetInvoiceId: String(dst._id), moved: 2, skipped: 0, amount: 35 });
    expect(srcLines.every((l) => String(l.invoiceId) === String(dst._id))).toBe(true);
    const log = model.updates.find(([, u]) => Boolean((u as Doc).$push));
    expect((log![1] as Doc).$push).toMatchObject({ mergeLog: { strategy: 'append', moved: 2, skipped: 0 } });
    const del = model.updates.find(([f, u]) => String((f as Doc)._id) === String(src._id) && Boolean(((u as Doc).$set as Doc | undefined)?.deletedAt));
    expect((del![1] as Doc).$set).toMatchObject({ mergedInto: dst._id, status: 'cancelled' });
    expect(requests.updates.filter(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).priceHint !== undefined)).toHaveLength(0);
  });

  it('mergeSameRequest: одинаковые строки источника гасятся, остальные переезжают', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', amount: 20, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'B', amount: 10, fileIds: [] };
    const mat = new Types.ObjectId();
    const srcLines = [{ ...mkLines(src._id, [10])[0], materialId: mat, qty: 2 }, mkLines(src._id, [20])[0]];
    const dstLines = [{ ...mkLines(dst._id, [10])[0], materialId: mat, qty: 2 }];
    const { svc, requests } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines: [...srcLines, ...dstLines] });
    const r = await svc.merge(String(src._id), String(dst._id), 'mergeSameRequest');
    expect(r).toMatchObject({ moved: 1, skipped: 1 });
    const skipped = requests.updates.find(([f, u]) => String((f as Doc)._id) === String(srcLines[0]._id) && Boolean(((u as Doc).$set as Doc).deletedAt));
    expect((skipped![1] as Doc).$set).toMatchObject({ status: 'cancelled' });
  });

  it('replaceLines: строки цели отвязываются, в счёте остаются строки источника', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', amount: 30, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'B', amount: 5, fileIds: [] };
    const srcLines = mkLines(src._id, [10, 20]);
    const dstLines = mkLines(dst._id, [5]);
    const { svc, requests } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines: [...srcLines, ...dstLines] });
    const r = await svc.merge(String(src._id), String(dst._id), 'replaceLines');
    expect(r).toMatchObject({ moved: 2, replaced: 1, amount: 30 });
    const detached = requests.updates.find(([f, u]) => String((f as Doc)._id) === String(dstLines[0]._id) && Boolean((u as Doc).$unset));
    expect((detached![1] as Doc).$unset).toHaveProperty('invoiceId');
  });

  it.each(['append', 'mergeSameRequest', 'replaceLines'] as const)('%s: перенесённые строки получают №, дату и плательщика цели', async (strategy) => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', date: new Date('2026-10-01'), payerCompanyId: new Types.ObjectId(), amount: 30, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'issued', no: 'B', date: new Date('2026-10-15'), payerCompanyId: new Types.ObjectId(), amount: 5, fileIds: [] };
    const srcLines = mkLines(src._id, [10, 20], { invoiceNo: src.no, invoiceDate: src.date, companyId: src.payerCompanyId });
    const dstLines = mkLines(dst._id, [5]);
    const { svc, requests } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines: [...srcLines, ...dstLines] });
    await svc.merge(String(src._id), String(dst._id), strategy);
    for (const line of srcLines) {
      expect(line).toMatchObject({ invoiceId: dst._id, invoiceNo: dst.no, invoiceDate: dst.date, companyId: dst.payerCompanyId });
      expect(requests.updateOne).toHaveBeenCalledWith({ _id: line._id }, expect.objectContaining({ $set: expect.objectContaining({ invoiceNo: dst.no, invoiceDate: dst.date, companyId: dst.payerCompanyId }) }), expect.objectContaining({ session: expect.anything() }));
    }
    expect(srcLines.map((l) => l.priceHint)).toEqual([10, 20]);
  });

  it('пустые метаданные цели заполняются из источника одинаково в счёте и строках', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', no: 'A', date: new Date('2026-10-01'), payerCompanyId: new Types.ObjectId(), amount: 10, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 0, fileIds: [] };
    const lines = mkLines(src._id, [10]);
    const { svc } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines });
    await svc.merge(String(src._id), String(dst._id), 'append');
    expect(dst).toMatchObject({ no: src.no, date: src.date, payerCompanyId: src.payerCompanyId });
    expect(lines[0]).toMatchObject({ invoiceNo: src.no, invoiceDate: src.date, companyId: src.payerCompanyId });
  });

  it('если метаданных нет у обоих счетов, старые снимки в строке очищаются', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 10, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 0, fileIds: [] };
    const lines = mkLines(src._id, [10], { invoiceNo: 'Устарел', invoiceDate: new Date(), companyId: new Types.ObjectId() });
    const { svc } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst }, lines });
    await svc.merge(String(src._id), String(dst._id), 'append');
    expect(lines[0]).toMatchObject({ invoiceNo: null, invoiceDate: null, companyId: null });
  });

  it('счёт с приёмкой/оплатой объединять нельзя', async () => {
    const src = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 30, fileIds: [] };
    const dst = { _id: new Types.ObjectId(), supplierId: sup, status: 'paid', amount: 5, fileIds: [] };
    const { svc } = makeSvc({ invoices: { [String(src._id)]: src, [String(dst._id)]: dst } });
    await expect(svc.merge(String(src._id), String(dst._id), 'append')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Счета: правка цены строки', () => {
  const mk = (status = 'issued') => {
    const invId = new Types.ObjectId();
    const lineId = new Types.ObjectId();
    const inv = { _id: invId, supplierId: new Types.ObjectId(), status, amount: 30, version: 0, fileIds: [] };
    const line = { _id: lineId, num: 1, title: 'Болт', invoiceId: invId, qty: 3, unit: 'шт', priceHint: 30, status: 'ordered', materialId: new Types.ObjectId() };
    const made = makeSvc({ invoices: { [String(invId)]: inv }, lines: [line] });
    return { ...made, inv, line, invId, lineId };
  };

  it('unitPrice × количество → amount пересчитан, история записана', async () => {
    const { svc, requests, prices, invId, lineId } = mk('issued');
    const r = await svc.updateLine(String(invId), String(lineId), { unitPrice: 25 });
    expect(requests.updateOne).toHaveBeenCalledWith({ _id: lineId }, expect.objectContaining({ $set: expect.objectContaining({ priceHint: 75 }) }), expect.anything());
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ lineTotalWithVat: 75, qty: 3, source: 'invoice_issued' }), expect.anything());
    expect(r).toMatchObject({ amount: 75, line: { qty: 3, unitPrice: 25, lineAmount: 75 } });
  });

  it('lineAmount → обратный пересчёт цены за единицу', async () => {
    const { svc, invId, lineId } = mk('issued');
    const r = await svc.updateLine(String(invId), String(lineId), { lineAmount: 100 });
    expect(r.line).toMatchObject({ qty: 3, unitPrice: 33.33, lineAmount: 100 });
  });

  it('qty + unitPrice: количество, сумма строки, amount и история меняются в транзакции', async () => {
    const { svc, inv, line, requests, prices, invId, lineId } = mk('issued');
    const r = await svc.updateLine(String(invId), String(lineId), { qty: 4, unitPrice: 12.34 });
    expect(line).toMatchObject({ qty: 4, priceHint: 49.36 });
    expect(inv.amount).toBe(49.36);
    expect(r.line).toEqual({ id: String(lineId), qty: 4, unitPrice: 12.34, lineAmount: 49.36 });
    expect(requests.updateOne).toHaveBeenCalledWith({ _id: lineId }, expect.objectContaining({ $set: expect.objectContaining({ qty: 4, priceHint: 49.36 }) }), expect.objectContaining({ session: expect.anything() }));
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ qty: 4, lineTotalWithVat: 49.36 }), expect.anything());
  });

  it('только qty: сохраняет прежнюю цену за единицу и пересчитывает amount', async () => {
    const { svc, invId, lineId } = mk('draft');
    const r = await svc.updateLine(String(invId), String(lineId), { qty: 2.5 });
    expect(r).toMatchObject({ amount: 25, line: { qty: 2.5, unitPrice: 10, lineAmount: 25 } });
  });

  it('qty + lineAmount: явная сумма имеет прежний приоритет над unitPrice', async () => {
    const { svc, invId, lineId } = mk();
    const r = await svc.updateLine(String(invId), String(lineId), { qty: 4, lineAmount: 80, unitPrice: 99 });
    expect(r).toMatchObject({ amount: 80, line: { qty: 4, unitPrice: 20, lineAmount: 80 } });
  });

  it.each([0, -1, NaN, Infinity])('qty=%s → 400 до записи', async (qty) => {
    const { svc, requests, invId, lineId } = mk();
    await expect(svc.updateLine(String(invId), String(lineId), { qty, unitPrice: 10 })).rejects.toBeInstanceOf(BadRequestException);
    expect(requests.updateOne).not.toHaveBeenCalled();
  });

  it('qty + unitPrice заполняют строку с прежним нулевым количеством', async () => {
    const { svc, line, invId, lineId } = mk();
    line.qty = 0;
    const r = await svc.updateLine(String(invId), String(lineId), { qty: 2, unitPrice: 10 });
    expect(r).toMatchObject({ amount: 20, line: { qty: 2, unitPrice: 10, lineAmount: 20 } });
  });

  it('только qty при прежнем нулевом количестве → 400, нужна цена', async () => {
    const { svc, line, requests, invId, lineId } = mk();
    line.qty = 0;
    await expect(svc.updateLine(String(invId), String(lineId), { qty: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(requests.updateOne).not.toHaveBeenCalled();
  });

  it('черновик пишет историю как manual', async () => {
    const { svc, prices, invId, lineId } = mk('draft');
    await svc.updateLine(String(invId), String(lineId), { unitPrice: 11 });
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }), expect.anything());
  });

  it('оплаченный до приёмки: правка строки пересчитывает сумму и обновляет историю invoice_paid', async () => {
    const { svc, inv, requests, prices, invId, lineId } = mk('paid');
    const r = await svc.updateLine(String(invId), String(lineId), { unitPrice: 25, reason: 'Сверка' }, '111111111111111111111111');
    expect(r).toMatchObject({ amount: 75, line: { qty: 3, unitPrice: 25, lineAmount: 75 } });
    expect(requests.updateOne).toHaveBeenCalledWith({ _id: lineId }, expect.objectContaining({ $set: expect.objectContaining({ priceHint: 75 }) }), expect.anything());
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ lineTotalWithVat: 75, source: 'invoice_adjustment' }), expect.anything());
    expect(inv.amount).toBe(75);
    expect((inv as Record<string, unknown>).paymentAdjustments).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'Сверка', operation: 'line_edit', beforeAmount: 30, afterAmount: 75, delta: 45 })]));
  });

  it('оплаченный после первой приёмки: правка строки запрещена', async () => {
    const { svc, requests, invId, lineId } = mk('paid');
    requests.countDocuments.mockReturnValue(chain(1));
    await expect(svc.updateLine(String(invId), String(lineId), { unitPrice: 25 })).rejects.toThrow(/приёмка/i);
    expect(requests.updateOne).not.toHaveBeenCalled();
  });

  it('есть приёмка на склад — отказ', async () => {
    const { svc, model, requests, invId, lineId } = mk('issued');
    requests.countDocuments.mockReturnValue(chain(1));
    await expect(svc.updateLine(String(invId), String(lineId), { unitPrice: 25 })).rejects.toThrow(/приёмка/i);
    expect(requests.updateOne).not.toHaveBeenCalled();
    expect(model.updates).toHaveLength(0);
  });

  it('несовпадение версии → 409', async () => {
    const { svc, inv, invId, lineId } = mk('issued');
    inv.version = 4;
    await expect(svc.updateLine(String(invId), String(lineId), { unitPrice: 25, version: 3 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('без unitPrice и lineAmount — 400', async () => {
    const { svc, invId, lineId } = mk('issued');
    await expect(svc.updateLine(String(invId), String(lineId), {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('убрать строку: заявка возвращается в «В заказ», amount пересчитан', async () => {
    const invId = new Types.ObjectId();
    const keep = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 60, status: 'ordered' };
    const drop = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 40, status: 'ordered' };
    const inv = { _id: invId, status: 'issued', amount: 100, version: 0, fileIds: [] };
    const { svc, model, requests } = makeSvc({ invoices: { [String(invId)]: inv }, lines: [keep, drop] });
    const r = await svc.removeLine(String(invId), String(drop._id));
    expect(r.amount).toBe(60);
    expect(requests.updateOne).toHaveBeenCalledWith({ _id: drop._id }, expect.objectContaining({ $unset: expect.objectContaining({ invoiceId: '' }), $set: expect.objectContaining({ status: 'requested' }) }), expect.anything());
    const amountUpd = model.updates.find(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).amount !== undefined);
    expect((amountUpd![1] as Doc).$set).toMatchObject({ amount: 60 });
  });
});

describe('Счета: добавление позиций', () => {
  const sup = new Types.ObjectId();
  const mk = (status: string) => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, supplierId: sup, status, amount: 100, paidAt: new Date('2026-10-05'), fileIds: [] };
    const old1 = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 60, status: 'ordered', supplierId: sup };
    const old2 = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 40, status: 'ordered', supplierId: sup };
    const fresh = { _id: new Types.ObjectId(), num: 5, title: 'Болт', status: 'in_progress', supplierId: sup, materialId: new Types.ObjectId(), qty: 2, unit: 'шт', priceHint: 25 };
    const made = makeSvc({ invoices: { [String(invId)]: inv }, lines: [old1, old2, fresh] });
    return { ...made, inv, invId, old1, old2, fresh };
  };

  it('в выставленный: старые цены не меняются, amount = сумма всех строк', async () => {
    const { svc, model, requests, invId, old1, old2, fresh } = mk('issued');
    const r = await svc.addRequests(String(invId), [String(fresh._id)]);
    expect(r.amount).toBe(125);
    expect(old1.priceHint).toBe(60);
    expect(old2.priceHint).toBe(40);
    const amountUpd = model.updates.find(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).amount !== undefined);
    expect((amountUpd![1] as Doc).$set).toMatchObject({ amount: 125 });
    expect(requests.updates.filter(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).priceHint !== undefined)).toHaveLength(0);
  });

  it('в оплаченный до приёмки можно добавить новую оплаченную строку, обновить сумму и историю', async () => {
    const { svc, model, requests, prices, invId, fresh } = mk('paid');
    const r = await svc.addRequests(String(invId), [String(fresh._id)], 'Сверка', '111111111111111111111111');
    expect(r.amount).toBe(125);
    expect(requests.updateMany).toHaveBeenCalledWith(expect.objectContaining({ _id: { $in: [fresh._id] } }),
      expect.objectContaining({ $set: expect.objectContaining({ invoiceId: invId, paid: true, paidAt: expect.any(Date) }) }), expect.anything());
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'invoice_adjustment', lineTotalWithVat: 25 }), expect.anything());
    expect(model.updates.some(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).amount === 125)).toBe(true);
  });

  it('в счёт с приёмкой — отказ', async () => {
    const { svc, requests, invId, fresh } = mk('issued');
    requests.countDocuments.mockReturnValue(chain(1));
    await expect(svc.addRequests(String(invId), [String(fresh._id)])).rejects.toThrow(/приёмка/i);
    expect(requests.updateMany).not.toHaveBeenCalled();
  });
});

describe('Счета: оплата', () => {
  const mk = () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'issued', amount: 100, payerCompanyId: new Types.ObjectId(), version: 0, fileIds: [] };
    const lines = [
      { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 60, status: 'ordered', materialId: new Types.ObjectId() },
      { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 40, status: 'ordered', materialId: new Types.ObjectId() },
    ];
    return { ...makeSvc({ invoices: { [String(invId)]: inv }, lines }), invId, lines };
  };

  it('цены строк не перераспределяются, история пишется по каждой строке', async () => {
    const { svc, requests, prices, invId, lines } = mk();
    await svc.pay(String(invId));
    expect(lines.map((l) => l.priceHint)).toEqual([60, 40]);
    expect(requests.updates.filter(([, u]) => (u as Doc).$set && ((u as Doc).$set as Doc).priceHint !== undefined)).toHaveLength(0);
    expect(prices.record).toHaveBeenCalledTimes(2);
    expect(prices.record).toHaveBeenCalledWith(expect.objectContaining({ lineTotalWithVat: 60, source: 'invoice_paid' }), expect.anything());
  });

  it('amount ≠ сумма строк — оплата запрещена', async () => {
    const { svc, invId } = mk();
    const svcInv = (svc as unknown as { model: { findOne: jest.Mock } }).model;
    svcInv.findOne.mockReturnValue(chain({ _id: invId, status: 'issued', amount: 999, payerCompanyId: new Types.ObjectId() }));
    await expect(svc.pay(String(invId))).rejects.toThrow(/суммой строк/i);
  });
});

describe('Счета: блокировка после первой приёмки', () => {
  it('оплаченный: метаданные и сумму по строкам можно скорректировать до приёмки', async () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'paid', supplierId: new Types.ObjectId(), amount: 100, paidAt: new Date(), version: 1, fileIds: [] };
    const line = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 100, status: 'ordered' };
    const { svc, model } = makeSvc({ invoices: { [String(invId)]: inv }, lines: [line] });
    await svc.update(String(invId), { fileIds: [String(new Types.ObjectId())] } as never);
    expect(model.updates.length).toBeGreaterThan(0);
    await expect(svc.update(String(invId), { amount: 100 } as never)).resolves.toMatchObject({ amount: 100 });
    await expect(svc.update(String(invId), { no: 'INV-PAID-1' } as never)).resolves.toMatchObject({ amount: 100 });
    await expect(svc.update(String(invId), { amount: 500 } as never)).rejects.toThrow(/по строкам/i);
  });

  it('первая приёмка блокирует изменения оплаченного счёта', async () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'paid', amount: 100, version: 1, fileIds: [] };
    const { svc, requests } = makeSvc({ invoices: { [String(invId)]: inv } });
    requests.countDocuments.mockReturnValue(chain(1));
    await expect(svc.update(String(invId), { amount: 100 } as never)).rejects.toThrow(/приёмка/i);
  });

  it('после первой приёмки новую позицию добавить нельзя', async () => {
    const invId = new Types.ObjectId();
    const reqId = new Types.ObjectId();
    const inv = { _id: invId, status: 'paid', supplierId: new Types.ObjectId(), amount: 100, fileIds: [] };
    const fresh = { _id: reqId, status: 'in_progress', supplierId: inv.supplierId, qty: 1, unit: 'шт' };
    const { svc, requests } = makeSvc({ invoices: { [String(invId)]: inv }, lines: [fresh] });
    requests.countDocuments.mockReturnValue(chain(1));
    await expect(svc.addRequests(String(invId), [String(reqId)])).rejects.toThrow(/приёмка/i);
    expect(requests.updateMany).not.toHaveBeenCalled();
  });

  it('оплаченный: удалить счёт нельзя', async () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'paid', amount: 100, fileIds: [] };
    const { svc } = makeSvc({ invoices: { [String(invId)]: inv } });
    await expect(svc.remove(String(invId))).rejects.toThrow(/оплачен/i);
  });

  it('оплаченный до приёмки: админ может убрать строку — сумма и корректировка', async () => {
    const invId = new Types.ObjectId();
    const keep = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 60, status: 'ordered', paid: true };
    const drop = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 40, status: 'ordered', paid: true };
    const inv = { _id: invId, status: 'paid', amount: 100, fileIds: [] };
    const { svc, model, requests } = makeSvc({ invoices: { [String(invId)]: inv }, lines: [keep, drop] });
    const r = await svc.removeLine(String(invId), String(drop._id), '111111111111111111111111');
    expect(r.amount).toBe(60);
    expect(requests.updateOne).toHaveBeenCalledWith({ _id: drop._id }, expect.objectContaining({ $unset: expect.objectContaining({ invoiceId: '' }) }), expect.anything());
    expect(model.updates.some(([, u]) => (u as Doc).$push && ((u as Doc).$push as Doc).paymentAdjustments)).toBe(true);
  });

  it('есть приёмка: удалить счёт нельзя', async () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'issued', amount: 100, fileIds: [] };
    const { svc, requests } = makeSvc({ invoices: { [String(invId)]: inv } });
    requests.countDocuments.mockReturnValue(chain(2));
    await expect(svc.remove(String(invId))).rejects.toThrow(/приёмка/i);
  });

  it('amount нельзя ввести вручную, если он не равен сумме строк', async () => {
    const invId = new Types.ObjectId();
    const inv = { _id: invId, status: 'draft', amount: 60, version: 0, fileIds: [] };
    const line = { _id: new Types.ObjectId(), invoiceId: invId, qty: 1, priceHint: 60, status: 'ordered' };
    const { svc } = makeSvc({ invoices: { [String(invId)]: inv }, lines: [line] });
    await expect(svc.update(String(invId), { amount: 999 } as never)).rejects.toThrow(/по строкам/i);
  });
});


describe('T27: реквизиты оплаченного счёта не переписывают факт цены оплаты', () => {
  it('после исправления/добавления строк no/date/fileIds не создают новый invoice_paid и сохраняют исходную цену', async () => {
    const invId = new Types.ObjectId();
    const original = new Types.ObjectId();
    const added = new Types.ObjectId();
    const materialId = new Types.ObjectId();
    const invoices: Record<string, Doc> = { [String(invId)]: { _id: invId, status: 'paid', amount: 200, fileIds: [], supplierId: new Types.ObjectId(), paymentSnapshot: { amount: 100 } } };
    const lines = [
      { _id: original, invoiceId: invId, materialId, status: 'ordered', qty: 2, priceHint: 150 },
      { _id: added, invoiceId: invId, materialId, status: 'ordered', qty: 1, priceHint: 50 },
    ];
    const originalPaymentPrice = { requestId: original, source: 'invoice_paid', lineTotalWithVat: 100, qty: 2 };
    const history = new Map<string, Doc>([[String(original), originalPaymentPrice]]);
    const prices = { record: jest.fn(async (row: Doc) => { if (row.source === 'invoice_paid') history.set(String(row.requestId), row); return true; }) };
    const { svc } = makeSvc({ invoices, lines, prices });
    await svc.update(String(invId), { no: 'PAID-META', date: '2026-11-03', fileIds: [] } as never);
    expect(prices.record).not.toHaveBeenCalled();
    expect(history.get(String(original))).toEqual(originalPaymentPrice);
    expect(history.has(String(added))).toBe(false);
    expect(invoices[String(invId)].paymentSnapshot).toEqual({ amount: 100 });
    expect(lines.map((line) => line.priceHint)).toEqual([150, 50]);
  });
});

describe('ЗЯ-1b: снятие оплаты со счёта (сторно)', () => {
  const admin = { id: String(new Types.ObjectId()), role: 'admin', username: 'boss' };
  const mk = (extra: Doc = {}) => {
    const invId = new Types.ObjectId(), lineId = new Types.ObjectId();
    const inv = { _id: invId, status: 'paid', amount: 30, version: 0, paidAt: new Date('2026-11-01'), paymentSnapshot: { amount: 30, paidAt: new Date('2026-11-01'), lines: [] }, ...extra };
    const line = { _id: lineId, invoiceId: invId, priceHint: 30, status: 'ordered', paid: true, paidAt: new Date('2026-11-01') };
    const audit = { log: jest.fn(async (e: Doc) => void e) };
    return { ...makeSvc({ invoices: { [String(invId)]: inv }, lines: [line], audit }), inv, line, invId, audit };
  };

  it('dryRun: сумма в warnings, данные не тронуты', async () => {
    const { svc, inv, invId, audit } = mk();
    const r = await svc.unpay(String(invId), {}, admin, true) as { canProceed: boolean; warnings: string[] };
    expect(r.canProceed).toBe(true);
    expect(r.warnings[0]).toMatch(/Оплата 30 ₽/);
    expect(inv.status).toBe('paid');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('admin с причиной: счёт «выставлен», строки без оплаты, сторно в paymentAdjustments и журнале', async () => {
    const { svc, inv, line, invId, audit } = mk();
    await svc.unpay(String(invId), { confirm: true, reason: 'оплатили не тот счёт' }, admin);
    expect(inv.status).toBe('issued');
    expect(inv).not.toHaveProperty('paymentSnapshot');
    expect(line.paid).toBe(false);
    expect(line).not.toHaveProperty('paidAt');
    expect((inv as Doc).paymentAdjustments).toEqual([expect.objectContaining({ operation: 'payment_reversed', reason: 'оплатили не тот счёт', delta: -30 })]);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'admin.override', details: { before: { status: 'paid', amount: 30 }, after: { status: 'issued' }, meta: { rule: 'supply.invoice_unpay' } } });
  });

  it('без причины → 400, счёт остаётся оплаченным', async () => {
    const { svc, inv, invId } = mk();
    await expect(svc.unpay(String(invId), { confirm: true }, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(inv.status).toBe('paid');
  });

  it('менеджер → 403', async () => {
    const { svc, inv, invId } = mk();
    await expect(svc.unpay(String(invId), { confirm: true, reason: 'хочу' }, { role: 'manager' })).rejects.toMatchObject({ status: 403 });
    expect(inv.status).toBe('paid');
  });

  it('есть приёмка → блок: сначала откат приёмки', async () => {
    const { svc, inv, invId } = mk({ receiptBoundaryAt: new Date() });
    await expect(svc.unpay(String(invId), { confirm: true, reason: 'ошибка' }, admin)).rejects.toBeInstanceOf(ConflictException);
    expect(inv.status).toBe('paid');
  });

  it('счёт не оплачен → 400', async () => {
    const { svc, invId } = mk({ status: 'issued' });
    await expect(svc.unpay(String(invId), { confirm: true, reason: 'ошибка' }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ЗЯ-1: администратор правит сумму строки счёта через заявку', () => {
  const mk = (status: string, extra: Doc = {}) => {
    const invId = new Types.ObjectId(), lineId = new Types.ObjectId();
    const inv = { _id: invId, supplierId: new Types.ObjectId(), status, amount: 30, version: 0, fileIds: [], ...extra };
    const line = { _id: lineId, num: 1, title: 'Болт', invoiceId: invId, qty: 3, unit: 'шт', priceHint: 30, status: 'ordered', materialId: new Types.ObjectId() };
    const audit = { log: jest.fn(async (e: Doc) => void e) };
    return { ...makeSvc({ invoices: { [String(invId)]: inv }, lines: [line], audit }), inv, line, lineId, audit };
  };
  const admin = { id: String(new Types.ObjectId()), role: 'admin', username: 'boss' };

  it.each(['issued', 'paid'])('счёт %s без приёмки: сумма и amount пересчитаны, журнал было/стало', async (status) => {
    const { svc, inv, line, lineId, audit } = mk(status);
    const ok = await svc.adminEditLine(String(lineId), { priceHint: 50, reason: 'сверка с поставщиком' }, admin);
    expect(ok).toBe(true);
    expect(line.priceHint).toBe(50);
    expect(inv.amount).toBe(50);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'admin.override', entityType: 'SupplyRequest', details: { before: { priceHint: 30, qty: 3, invoiceAmount: 30 }, after: { priceHint: 50, qty: 3, invoiceAmount: 50 }, meta: { rule: 'supply.invoiced_line', reason: 'сверка с поставщиком' } } });
  });

  it('без причины → 400, строка не тронута', async () => {
    const { svc, line, lineId, audit } = mk('issued');
    await expect(svc.adminEditLine(String(lineId), { priceHint: 50 }, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(line.priceHint).toBe(30);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('после приёмки admin исправляет цену (решение 2026-11-06): сумма и amount пересчитаны, журнал один', async () => {
    const { svc, inv, line, lineId, audit } = mk('paid', { receiptBoundaryAt: new Date() });
    line.status = 'received';
    expect(await svc.adminEditLine(String(lineId), { priceHint: 50, reason: 'поправка' }, admin)).toBe(true);
    expect(line.priceHint).toBe(50);
    expect(inv.amount).toBe(50);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('после приёмки количество принятой строки не меняется даже у admin', async () => {
    const { svc, line, lineId } = mk('paid', { receiptBoundaryAt: new Date() });
    line.status = 'received';
    await expect(svc.adminEditLine(String(lineId), { qty: 5, reason: 'поправка' }, admin)).rejects.toThrow(/отменой приёмки/);
    expect(line.qty).toBe(3);
  });

  it('после приёмки менеджер цену не меняет', async () => {
    const { svc, inv, line, lineId } = mk('paid', { receiptBoundaryAt: new Date() });
    await expect(svc.updateLine(String(inv._id), String(lineId), { lineAmount: 50 }, undefined, { role: 'manager' })).rejects.toThrow(/администратор/);
    expect(line.priceHint).toBe(30);
  });

  it('прямая правка строки admin после приёмки — журнал с причиной по умолчанию', async () => {
    const { svc, inv, line, lineId, audit } = mk('paid', { receiptBoundaryAt: new Date() });
    await svc.updateLine(String(inv._id), String(lineId), { lineAmount: 45 }, admin.id, admin);
    expect(line.priceHint).toBe(45);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ details: { meta: { rule: 'supply.price_after_receipt' } } });
  });

  it('заявка без счёта → false (обычный путь)', async () => {
    const { svc, line, lineId } = mk('issued');
    delete (line as Doc).invoiceId;
    expect(await svc.adminEditLine(String(lineId), { priceHint: 50, reason: 'поправка' }, admin)).toBe(false);
  });
});
