import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OffersService } from './offers.service';

/** ЗЯ-1: администратор правит оплаченное КП и меняет статус «назад» — с причиной и записью в журнал. */
describe('OffersService: обход администратором', () => {
  const doc = (extra: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), status: 'paid', items: [], total: 0, companyId: new Types.ObjectId(), customer: 'К', ...extra });
  let cur: Record<string, unknown>;
  let model: { findOne: jest.Mock; updateOne: jest.Mock };
  let audit: { log: jest.Mock };
  let svc: OffersService;
  const admin = { id: String(new Types.ObjectId()), username: 'boss', role: 'admin' };
  const manager = { id: String(new Types.ObjectId()), username: 'man', role: 'manager' };

  beforeEach(() => {
    cur = doc();
    const chain = () => ({ lean: () => ({ exec: async () => cur }), exec: async () => ({ matchedCount: 1 }) });
    model = { findOne: jest.fn(chain), updateOne: jest.fn(chain) };
    audit = { log: jest.fn(async () => undefined) };
    svc = new OffersService({} as never, model as never, {} as never, {} as never, {} as never, {} as never, audit as never);
    jest.spyOn(svc, 'get').mockResolvedValue({} as never);
  });

  it('статус: менеджер из «Оплачено» — прежняя ошибка, журнала нет', async () => {
    await expect(svc.setStatus(String(cur._id), 'accepted', manager, 'ошибка')).rejects.toThrow('КП оплачено — менять статус нельзя');
    expect(audit.log).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('статус: администратор без причины — 400, без записи', async () => {
    await expect(svc.setStatus(String(cur._id), 'accepted', admin)).rejects.toThrow(BadRequestException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('статус: администратор с причиной — переход выполнен, в журнале было/стало', async () => {
    await svc.setStatus(String(cur._id), 'accepted', admin, 'клиент отозвал оплату');
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    const e = audit.log.mock.calls[0][0];
    expect(e).toMatchObject({ action: 'admin.override', entityType: 'CommercialOffer', userId: admin.id, details: { before: { status: 'paid' }, after: { status: 'accepted' }, meta: { rule: 'offer.status_jump', reason: 'клиент отозвал оплату' } } });
  });

  it('статус: обычный шаг администратора не пишет обход', async () => {
    cur = doc({ status: 'accepted' });
    await svc.setStatus(String(cur._id), 'paid', admin);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('статус: заказ из КП создан — администратору «Оплачено» тоже закрыто', async () => {
    cur = doc({ orderId: new Types.ObjectId() });
    await expect(svc.setStatus(String(cur._id), 'accepted', admin, 'причина')).rejects.toThrow('КП оплачено');
  });

  it('правка оплаченного: менеджер — ошибка; администратор с причиной — запись и журнал', async () => {
    await expect(svc.update(String(cur._id), { notes: 'x' }, manager)).rejects.toThrow('правка закрыта');
    await expect(svc.update(String(cur._id), { notes: 'x' }, admin)).rejects.toThrow(BadRequestException);
    await svc.update(String(cur._id), { notes: 'x', reason: 'опечатка в условиях' }, admin);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0].details.meta).toMatchObject({ rule: 'offer.paid_edit', reason: 'опечатка в условиях' });
  });
});
