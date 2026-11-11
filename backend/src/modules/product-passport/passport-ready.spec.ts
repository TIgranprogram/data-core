import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { createReadyPassport, type ReadyHost } from './passport-ready';
import { PassportQueries } from './passport-queries';
import { lastByFirm } from './passport-last-numbers';

const pdf = { buffer: Buffer.from('%PDF-1.4 x'), mimetype: 'application/pdf', size: 10, originalname: 'ready.pdf' };
const product = new Types.ObjectId();
const firm = new Types.ObjectId();
const order = new Types.ObjectId();
const income = new Types.ObjectId();

/** Память вместо Mongo: изделие, наша фирма, заказ, позиция; паспорта — массив. */
function mem(over: { twinNumber?: string; liveOnIncome?: boolean; noProduct?: boolean; notOur?: boolean } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const chain = (v: unknown) => ({ select: () => chain(v), setOptions: () => chain(v), session: () => chain(v), lean: () => chain(v), exec: async () => v });
  const model = {
    findOne: (q: Record<string, unknown>) => {
      if (q.passportNumber && over.twinNumber === q.passportNumber) return chain({ name: 'Горка' });
      if (q.incomeId && over.liveOnIncome) return chain({ passportNumber: '600', name: 'Урна' });
      return chain(null);
    },
    create: async (set: Record<string, unknown>) => { created.push(set); return { _id: new Types.ObjectId(), ...set }; },
  };
  const connection = {
    db: {
      collection: (name: string) => ({
        findOne: async () => {
          if (name === 'products') return over.noProduct ? null : { _id: product, name: 'Стойка', article: 'A1' };
          if (name === 'organizations') return over.notOur ? null : { _id: firm, name: 'СИЮ' };
          if (name === 'salesorders') return { _id: order, orderNo: '12', customer: 'Парк' };
          if (name === 'incomes') return { _id: income, orderId: order, productId: product };
          return null;
        },
      }),
    },
  };
  const host: ReadyHost = {
    model: model as never, connection: connection as never,
    allocate: async (set) => { if (!set.passportNumber) Object.assign(set, { passportNumber: '613', passportNo: 613 }); set.productCode = '9'; set.warrantyCode = `202611-${set.passportNumber}`; },
    assertFree: async () => undefined,
  };
  return { host, created };
}
const dto = (o: Record<string, unknown> = {}) => ({ productId: String(product), supplierOrgId: String(firm), ...o }) as never;

describe('createReadyPassport (C072)', () => {
  let dir = '';
  const prev = process.env.UPLOAD_DIR;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pp-ready-')); process.env.UPLOAD_DIR = dir; });
  afterAll(async () => {
    if (prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prev;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('номер не передан — выдан сервером; паспорт выпущен, источник ready-file, файл прикреплён, категория не нужна', async () => {
    const { host, created } = mem();
    await createReadyPassport(host, dto(), pdf);
    expect(created[0]).toMatchObject({ passportNumber: '613', status: 'issued', source: 'ready-file', name: 'Стойка', article: 'A1', supplier: 'СИЮ' });
    expect((created[0].printFile as { path: string }).path).toMatch(/^\/uploads\/passport\//);
    expect(created[0].passportCategory).toBeUndefined();
  });

  it('номер из файла берётся как есть', async () => {
    const { host, created } = mem();
    await createReadyPassport(host, dto({ number: '612' }), pdf);
    expect(created[0]).toMatchObject({ passportNumber: '612', passportNo: 612 });
  });

  it('позиция заказа: заказ и заказчик подставляются', async () => {
    const { host, created } = mem();
    await createReadyPassport(host, dto({ incomeId: String(income) }), pdf);
    expect(created[0]).toMatchObject({ orderNo: '12', customerName: 'Парк' });
    expect(String(created[0].salesOrderId)).toBe(String(order));
  });

  it('занятый номер — 409 с названием паспорта', async () => {
    const { host, created } = mem({ twinNumber: '612' });
    await expect(createReadyPassport(host, dto({ number: '612' }), pdf)).rejects.toThrow('Номер 612 уже у паспорта «Горка»');
    await expect(createReadyPassport(host, dto({ number: '612' }), pdf)).rejects.toBeInstanceOf(ConflictException);
    expect(created).toHaveLength(0);
  });

  it('на позицию уже есть живой паспорт — 409 с названием', async () => {
    const { host } = mem({ liveOnIncome: true });
    await expect(createReadyPassport(host, dto({ incomeId: String(income) }), pdf)).rejects.toThrow('На эту позицию уже есть паспорт № 600 «Урна»');
  });

  it('нет изделия, не наша фирма, не PDF, нулевой номер — 400, ничего не записано', async () => {
    const a = mem({ noProduct: true });
    await expect(createReadyPassport(a.host, dto(), pdf)).rejects.toThrow('Изделие не найдено');
    const b = mem({ notOur: true });
    await expect(createReadyPassport(b.host, dto(), pdf)).rejects.toThrow('нашу фирму');
    const c = mem();
    await expect(createReadyPassport(c.host, dto(), { ...pdf, buffer: Buffer.from('hello'), mimetype: 'text/plain' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(createReadyPassport(c.host, dto({ number: '0' }), pdf)).rejects.toThrow('больше нуля');
    expect(a.created.length + b.created.length + c.created.length).toBe(0);
  });
});

describe('список по номерам (C072)', () => {
  const filterOf = (q: Record<string, unknown>) => (new PassportQueries({ oid: (v: unknown) => v } as never) as unknown as { filterOf: (q: Record<string, unknown>) => Record<string, unknown> }).filterOf(q);

  it('numberFrom / numberTo — диапазон по числовому номеру; без них поля нет', () => {
    expect(filterOf({ numberFrom: '600', numberTo: '650' }).passportNo).toEqual({ $gte: 600, $lte: 650 });
    expect(filterOf({ numberFrom: '600' }).passportNo).toEqual({ $gte: 600 });
    expect(filterOf({ numberTo: '10' }).passportNo).toEqual({ $lte: 10 });
    expect(filterOf({ numberFrom: 'abc' }).passportNo).toBeUndefined();
    expect(filterOf({}).passportNo).toBeUndefined();
  });

  it('«Архив» не включает готовые паспорта', () => {
    expect(filterOf({ legacy: '1' }).source).toEqual({ $nin: ['app', 'ready-file'] });
  });
});

describe('lastByFirm (C072)', () => {
  it('последний и число по каждой нашей фирме; без паспортов — null и 0', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    const connection = { collection: () => ({ find: () => ({ sort: () => ({ toArray: async () => [{ _id: a, name: 'СИЮ' }, { _id: b, shortName: 'ССЮ', name: 'Спорт' }] }) }) }) };
    const model = { aggregate: () => ({ exec: async () => [{ _id: a, last: 612, count: 40 }] }) };
    expect(await lastByFirm(model as never, connection as never)).toEqual([
      { orgId: String(a), name: 'СИЮ', last: 612, count: 40 },
      { orgId: String(b), name: 'ССЮ', last: null, count: 0 },
    ]);
  });
});
