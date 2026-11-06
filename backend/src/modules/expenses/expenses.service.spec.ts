import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';

const cid = new Types.ObjectId(), sub = new Types.ObjectId(), top = new Types.ObjectId();

/** Соединение с фирмой cid, подстатьёй sub и общей статьёй top. */
function svc(opts: { order?: boolean } = {}) {
  const coll = (n: string) => {
    if (n === 'organizations') return { find: () => ({ toArray: async () => [{ _id: cid, name: 'СИЮ' }] }) };
    if (n === 'settings') return { findOne: async () => null };
    if (n === 'expensearticles') return { findOne: async (f: { _id: Types.ObjectId }) => (String(f._id) === String(sub) ? { _id: sub, parentId: top } : String(f._id) === String(top) ? { _id: top, parentId: null } : null) };
    if (n === 'salesorders') return { findOne: async () => (opts.order ? { _id: new Types.ObjectId() } : null) };
    return { countDocuments: async () => 0, findOne: async () => null };
  };
  return new ExpensesService({ db: { collection: coll } } as never);
}
const ok = { date: '2026-05-10', amount: 1500.5, companyId: String(cid), articleId: String(sub), title: ' Аренда  крана ' };
const msg = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { expect(e).toBeInstanceOf(BadRequestException); return (e as Error).message; } };

describe('Прочие расходы: проверка полей', () => {
  it('правильное тело превращается в документ, название чистится', async () => {
    const f = await svc().fields(ok, false);
    expect(f).toMatchObject({ amount: 1500.5, title: 'Аренда крана' });
    expect((f.date as Date).toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });
  it('сумма больше нуля', async () => {
    expect(await msg(svc().fields({ ...ok, amount: 0 }, false))).toBe('Сумма больше нуля');
    expect(await msg(svc().fields({ ...ok, amount: -3 }, false))).toBe('Сумма больше нуля');
  });
  it('статья обязательна и только подстатья', async () => {
    expect(await msg(svc().fields({ ...ok, articleId: undefined as never }, false))).toBe('Выберите статью');
    expect(await msg(svc().fields({ ...ok, articleId: String(top) }, false))).toBe('Выберите подстатью, а не общую статью');
    expect(await msg(svc().fields({ ...ok, articleId: String(new Types.ObjectId()) }, false))).toBe('Статья не найдена — выберите из списка');
  });
  it('фирма — только наша, дата — настоящая, название не пустое', async () => {
    expect(await msg(svc().fields({ ...ok, companyId: String(new Types.ObjectId()) }, false))).toBe('Выберите нашу фирму из списка');
    expect(await msg(svc().fields({ ...ok, date: '2026-02-31' }, false))).toBe('Дата — в формате ГГГГ-ММ-ДД');
    expect(await msg(svc().fields({ ...ok, title: '   ' }, false))).toBe('Укажите название');
  });
  it('объект — существующий заказ; пустая строка снимает привязку', async () => {
    expect(await msg(svc().fields({ ...ok, salesOrderId: String(new Types.ObjectId()) }, false))).toBe('Заказ не найден — выберите из списка');
    expect((await svc({ order: true }).fields({ ...ok, salesOrderId: String(new Types.ObjectId()) }, false)).salesOrderId).toBeInstanceOf(Types.ObjectId);
    expect((await svc().fields({ salesOrderId: '' }, true)).salesOrderId).toBeNull();
  });
  it('правка: проверяются только пришедшие поля', async () => {
    expect(await svc().fields({ title: 'Новое' }, true)).toEqual({ title: 'Новое' });
  });
});
