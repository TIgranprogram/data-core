import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductionOrdersService } from './production-orders.service';

const chain = (result: unknown) => { const c: Record<string, jest.Mock> = {}; for (const m of ['lean', 'setOptions']) c[m] = jest.fn(() => c); c.exec = jest.fn(async () => result); return c; };

/** КМ4: assign не пускает договоры с несопоставленными позициями. */
describe('ProductionOrdersService.assign — блок сопоставления', () => {
  const o1 = new Types.ObjectId(), o2 = new Types.ObjectId();
  const mk = (incomes: Array<Record<string, unknown>>, legal=false) => {
    const assignProduction = jest.fn(async () => undefined);
    const model = {
      find: jest.fn(() => chain([{ _id: o1, orderNo: '12',...(legal?{legal:{state:'draft'}}:{}) }, { _id: o2, orderNo: '13',...(legal?{legal:{state:'draft'}}:{}) }])),
    };
    const coll = () => ({ updateOne: async () => ({ matchedCount: 1 }), find: () => ({ sort: () => ({ toArray: async () => incomes }) }) });
    const session = { withTransaction: async (f: () => Promise<void>) => f(), endSession: async () => undefined };
    const conn = { db: { collection: coll }, startSession: async () => session };
    return { svc: new ProductionOrdersService(conn as never, model as never, { assignProduction } as never, { log: jest.fn() } as never, {} as never), assignProduction };
  };

  it('несопоставленные и пустые договоры → 400 со списком unmatched, запись не идёт', async () => {
    const { svc, assignProduction } = mk([{ orderId: o1, title: 'Трибуна', productId: new Types.ObjectId() }, { orderId: o1, title: 'Монтаж' }]);
    const err = await svc.assign([String(o1), String(o2)]).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse();
    expect(body.message).toContain('Договор № 12: не сопоставлено 1 из 2 позиций («Монтаж»)');
    expect(body.message).toContain('Договор № 13: нет позиций');
    expect(body.unmatched).toEqual([
      { orderId: String(o1), orderNo: '12', total: 2, unmatched: 1, lines: ['Монтаж'] },
      { orderId: String(o2), orderNo: '13', total: 0, unmatched: 0, lines: [] },
    ]);
    expect(assignProduction).not.toHaveBeenCalled();
  });

  it('новые legal draft группируются до сопоставления и без выдуманных изделий',async()=>{
    const {svc,assignProduction}=mk([{orderId:o1,title:'Секция',matchingMode:'manual'}],true);
    const r=await svc.assign([String(o1),String(o2)]);expect(r.orderIds).toHaveLength(2);expect(assignProduction).toHaveBeenCalled();
  });

  it('подтверждённые, «не изделие» и старые с изделием → блока нет, заказ создан', async () => {
    const { svc, assignProduction } = mk([
      { orderId: o1, title: 'Трибуна', productId: new Types.ObjectId(), matchStatus: 'confirmed' },
      { orderId: o1, title: 'Монтаж', matchStatus: 'none' },
      { orderId: o2, title: 'Урна', productId: new Types.ObjectId() },
    ]);
    const r = await svc.assign([String(o1), String(o2)], undefined);
    expect(r.orderIds).toEqual([String(o1), String(o2)]);
    expect(assignProduction).toHaveBeenCalled();
  });
});

describe('ProductionOrdersService.setStage — отмена', () => {
  it('отменить весь заказ нельзя: запись этапа не начинается', async () => {
    const advanceStage = jest.fn();
    const svc = new ProductionOrdersService({} as never, {} as never, { advanceStage } as never, {} as never, {} as never);
    await expect(svc.setStage('1-26', 'cancelled')).rejects.toThrow('Отменить можно только договор');
    expect(advanceStage).not.toHaveBeenCalled();
  });
});
