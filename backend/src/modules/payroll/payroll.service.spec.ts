import { Types } from 'mongoose';
import { PayrollService } from './payroll.service';

describe('HARDEN-1 п.13: выплата с clientUid', () => {
  const pid = new Types.ObjectId(), cid = new Types.ObjectId();
  const mk = (upsertedId?: Types.ObjectId) => {
    const pay = { updateOne: jest.fn(async () => ({ upsertedId })), insertOne: jest.fn(async () => ({ insertedId: new Types.ObjectId() })), findOne: jest.fn(async () => ({ _id: new Types.ObjectId(), month: '2026-10' })) };
    const coll = (n: string) => n === 'payroll_payments' ? pay
      : n === 'persons' ? { findOne: async () => ({ _id: pid }) }
      : { find: () => ({ project: undefined, toArray: async () => [{ _id: cid, name: 'ООО', isOurCompany: true }] }) };
    const svc = new PayrollService({ db: { collection: coll } } as never);
    return { svc, pay };
  };
  const dto = { personId: String(pid), companyId: String(cid), date: '2026-10-15', amount: 1000, clientUid: 'k1' } as never;
  it('с ключом — атомарный upsert по clientUid, вторая запись не создаётся', async () => {
    const t = mk();
    const r = await t.svc.addPayment(dto);
    expect(t.pay.updateOne).toHaveBeenCalledWith({ clientUid: 'k1' }, expect.objectContaining({ $setOnInsert: expect.anything() }), { upsert: true });
    expect(t.pay.insertOne).not.toHaveBeenCalled();
    expect(r.month).toBe('2026-10');
  });
});
