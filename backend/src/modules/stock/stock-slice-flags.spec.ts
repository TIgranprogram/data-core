import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockMovementsService } from './stock-movements.service';
import { StockReservationsService } from './stock-reservations.service';
import { StockSpecService } from './stock-spec.service';
import { STOCK_MOVE_API_FLAG } from './stock-move-flag';
import { STOCK_RESERVE_API_FLAG } from './stock-reserve-flag';

function moves(flags: { isEnabled: (key: string) => Promise<boolean> }) {
  const movements = { create: jest.fn(), exists: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };
  const svc = new StockMovementsService({} as never, movements as never, {} as never, {} as never, {} as never, {} as never, {} as never, flags as never);
  return { svc, movements };
}

describe('C263 — флаг движения', () => {
  const id = String(new Types.ObjectId());

  it('выключен — 409 на остаток, пакет, отмену и обрезку, записи нет', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const { svc, movements } = moves(flags);
    await expect(svc.move(id, { type: 'in', qty: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(svc.move(id, { type: 'count', qty: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(svc.move(id, { type: 'adjust', qty: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(svc.batch({ type: 'out', lines: [{ materialId: id, qty: 1 }] })).rejects.toMatchObject({ status: 409 });
    await expect(svc.cancelBatch(id)).rejects.toMatchObject({ status: 409 });
    await expect(svc.cancelMovement(id)).rejects.toMatchObject({ status: 409 });
    await expect(svc.correctMovement(id, 1)).rejects.toMatchObject({ status: 409 });
    await expect(svc.offcut(id, { lengthMm: 10 })).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(STOCK_MOVE_API_FLAG);
    expect(flags.isEnabled).not.toHaveBeenCalledWith(STOCK_RESERVE_API_FLAG);
    expect(movements.create).not.toHaveBeenCalled();
  });

  it('бронь на том же маршруте спрашивает флаг брони, не движения', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const { svc } = moves(flags);
    await expect(svc.move(id, { type: 'reserve', qty: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(svc.move(id, { type: 'unreserve', qty: 1 })).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(STOCK_RESERVE_API_FLAG);
    expect(flags.isEnabled).not.toHaveBeenCalledWith(STOCK_MOVE_API_FLAG);
  });

  it('приход и отмена внутри чужой транзакции флаг движения не спрашивают', async () => {
    const flags = { isEnabled: jest.fn(async () => { throw new Error('флаг'); }) };
    const { svc } = moves(flags);
    await expect(svc.move('x', { type: 'in', qty: 1 }, undefined, undefined, undefined, 'receipt')).rejects.toThrow(BadRequestException);
    await expect(svc.cancelMovement('x', undefined, {} as never)).rejects.toThrow(BadRequestException);
    expect(flags.isEnabled).not.toHaveBeenCalled();
  });
});

describe('C264 — флаг брони', () => {
  const id = String(new Types.ObjectId());

  it('выключен — 409 на бронь, снятие, выдачу и спецификацию', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const reservations = { create: jest.fn() };
    const resv = new StockReservationsService({} as never, {} as never, reservations as never, {} as never, {} as never, {} as never, flags as never);
    const spec = new StockSpecService({} as never, reservations as never, {} as never, {} as never, {} as never, flags as never);
    await expect(resv.reserveList({ lines: [{ materialId: id, qty: 1 }] })).rejects.toMatchObject({ status: 409 });
    await expect(resv.releaseReservation(id)).rejects.toMatchObject({ status: 409 });
    await expect(resv.releaseGroup(id)).rejects.toMatchObject({ status: 409 });
    await expect(resv.updateReservation(id, { qty: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(resv.issueReservations({ lines: [{ reservationId: id }] })).rejects.toMatchObject({ status: 409 });
    await expect(resv.issueOrder({ salesOrderId: id })).rejects.toMatchObject({ status: 409 });
    await expect(spec.apply({ salesOrderId: id, lines: [{ materialId: id, qty: 1 }] })).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(STOCK_RESERVE_API_FLAG);
    expect(flags.isEnabled).not.toHaveBeenCalledWith(STOCK_MOVE_API_FLAG);
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('просмотр спецификации и снятие в чужой транзакции флаг не спрашивают', async () => {
    const flags = { isEnabled: jest.fn(async () => { throw new Error('флаг'); }) };
    const resv = new StockReservationsService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, flags as never);
    const spec = new StockSpecService({} as never, {} as never, {} as never, { defaultWarehouse: async () => ({ _id: new Types.ObjectId() }) } as never, {} as never, flags as never);
    await expect(resv.releaseReservation('x', {} as never)).rejects.toThrow(BadRequestException);
    await expect(spec.preview({ salesOrderId: 'x', lines: [] })).rejects.toThrow();
    expect(flags.isEnabled).not.toHaveBeenCalled();
  });
});
