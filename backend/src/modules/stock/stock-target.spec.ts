import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { checkMoveFlags, prepareTarget, resolveReason, resolveTarget } from './stock-target';

const id = () => new Types.ObjectId();
type Row = Record<string, unknown> & { _id: Types.ObjectId };

/** Минимальная замена Db: findOne по _id, find().toArray() по dict. */
function fakeDb(data: Record<string, Row[]>) {
  return {
    collection: (name: string) => ({
      findOne: async (q: { _id: Types.ObjectId }) => (data[name] ?? []).find((r) => r._id.equals(q._id) && !r.deletedAt) ?? null,
      find: (q: { dict?: string }) => ({ toArray: async () => (data[name] ?? []).filter((r) => (!q.dict || r.dict === q.dict) && !r.deletedAt) }),
    }),
  } as never;
}
const fail = async (p: Promise<unknown>, text: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(BadRequestException);
  await expect(p).rejects.toThrow(text);
};

describe('resolveTarget', () => {
  const order = { _id: id() }, other = { _id: id() }, gone = { _id: id(), deletedAt: new Date() };
  const line = { _id: id(), orderId: order._id }, lineOfOther = { _id: id(), orderId: other._id }, lineNoOrder = { _id: id() };
  const person = { _id: id() };
  const db = fakeDb({ salesorders: [order, other, gone], incomes: [line, lineOfOther, lineNoOrder], persons: [person] });

  it('без полей — пусто (старые клиенты)', async () => expect(await resolveTarget(db, {})).toEqual({}));
  it('только позиция — заказ подставляет сервер', async () => {
    const r = await resolveTarget(db, { salesOrderLineId: String(line._id) });
    expect(r.salesOrderId).toEqual(order._id);
    expect(r.orderId).toBe(String(order._id));
    expect(r.salesOrderLineId).toEqual(line._id);
  });
  it('позиция чужого заказа — 400', () => fail(resolveTarget(db, { salesOrderId: String(order._id), salesOrderLineId: String(lineOfOther._id) }), /другому заказу/));
  it('позиция своего заказа — проходит', async () => {
    const r = await resolveTarget(db, { salesOrderId: String(order._id), salesOrderLineId: String(line._id) });
    expect(r.salesOrderLineId).toEqual(line._id);
  });
  it('позиции нет — 400', () => fail(resolveTarget(db, { salesOrderLineId: String(id()) }), /Позиция заказа не найдена/));
  it('позиция без заказа — 400', () => fail(resolveTarget(db, { salesOrderLineId: String(lineNoOrder._id) }), /не привязана/));
  it('заказа нет — 400', () => fail(resolveTarget(db, { salesOrderId: String(id()) }), /Заказ не найден/));
  it('заказ в корзине — 400', () => fail(resolveTarget(db, { salesOrderId: String(gone._id) }), /Заказ не найден/));
  it('сотрудник есть — записывается, текст обрезается по краям', async () => {
    const r = await resolveTarget(db, { personId: String(person._id), issuedTo: '  бригада 2 ' });
    expect(r.issuedToPersonId).toEqual(person._id);
    expect(r.issuedTo).toBe('бригада 2');
  });
  it('сотрудника нет — 400', () => fail(resolveTarget(db, { personId: String(id()) }), /Сотрудник не найден/));
  it('мусорный id — 400', () => fail(resolveTarget(db, { salesOrderLineId: 'abc' }), /Некорректный/));
});

describe('checkMoveFlags: списание и возврат', () => {
  it('обычная выдача и приход без новых полей — как раньше', () => {
    expect(checkMoveFlags({ type: 'out' })).toEqual({ writeOff: false, reason: undefined });
    expect(checkMoveFlags({ type: 'in' }).writeOff).toBe(false);
    expect(checkMoveFlags({ type: 'out', personId: String(id()) }).writeOff).toBe(false);
  });
  it('списание без причины — 400 с русским текстом', () => {
    expect(() => checkMoveFlags({ type: 'out', writeOff: true })).toThrow('Укажите причину списания');
    expect(() => checkMoveFlags({ type: 'out', writeOff: true, reason: '  ' })).toThrow('Укажите причину списания');
  });
  it('списание с причиной — проходит', () => expect(checkMoveFlags({ type: 'out', writeOff: true, reason: 'Брак' })).toEqual({ writeOff: true, reason: 'Брак' }));
  it('причина сама по себе = списание', () => expect(checkMoveFlags({ type: 'out', reason: 'Порча' }).writeOff).toBe(true));
  it('списание с заказом или сотрудником — 400', () => {
    expect(() => checkMoveFlags({ type: 'out', reason: 'Брак', salesOrderId: String(id()) })).toThrow(BadRequestException);
    expect(() => checkMoveFlags({ type: 'out', reason: 'Брак', issuedTo: 'бригада' })).toThrow(BadRequestException);
  });
  it('причина у прихода — 400', () => expect(() => checkMoveFlags({ type: 'in', reason: 'Брак' })).toThrow('только при списании'));
  it('возврат без позиции — 400', () => expect(() => checkMoveFlags({ type: 'in', isReturn: true })).toThrow(/позицию заказа/));
  it('возврат не у прихода — 400', () => expect(() => checkMoveFlags({ type: 'out', isReturn: true, salesOrderLineId: String(id()) })).toThrow('Возврат — это приход'));
  it('возврат с позицией — проходит', () => expect(checkMoveFlags({ type: 'in', isReturn: true, salesOrderLineId: String(id()) }).writeOff).toBe(false));
});

describe('причина из справочника', () => {
  const db = fakeDb({ dict_values: [
    { _id: id(), dict: 'writeOffReasons', name: 'Брак' }, { _id: id(), dict: 'writeOffReasons', name: 'Потеря' },
    { _id: id(), dict: 'writeOffReasons', name: 'Порча', deletedAt: new Date() }, { _id: id(), dict: 'units', name: 'Прочее' },
  ] });
  it('находит без учёта регистра и отдаёт название справочника', async () => expect(await resolveReason(db, ' брак ')).toBe('Брак'));
  it('нет в справочнике (удалённая и из чужого справочника) — 400', async () => {
    await fail(resolveReason(db, 'Порча'), /нет в справочнике/);
    await fail(resolveReason(db, 'Прочее'), /нет в справочнике/);
  });
  it('prepareTarget: списание с причиной пишет reason; без причины и с чужой — 400', async () => {
    expect(await prepareTarget(db, { type: 'out', writeOff: true, reason: 'потеря' })).toEqual({ reason: 'Потеря' });
    await fail(prepareTarget(db, { type: 'out', writeOff: true, reason: 'Выдумка' }), /нет в справочнике/);
    await fail(prepareTarget(db, { type: 'out', writeOff: true }), /Укажите причину списания/);
    expect(await prepareTarget(db, { type: 'out' })).toEqual({});
    expect(await prepareTarget(db, { type: 'count' })).toEqual({});
  });
  it('prepareTarget: возврат пишет isReturn, позицию и заказ', async () => {
    const order = { _id: id() }, line = { _id: id(), orderId: order._id };
    const d2 = fakeDb({ salesorders: [order], incomes: [line] });
    const r = await prepareTarget(d2, { type: 'in', isReturn: true, salesOrderLineId: String(line._id) });
    expect(r).toMatchObject({ isReturn: true, salesOrderId: order._id, salesOrderLineId: line._id });
  });
});
