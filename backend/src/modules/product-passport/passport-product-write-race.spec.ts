import { Types, type Connection } from 'mongoose';
import { passportProductVersion, withPassportProductWrite } from './passport-product-write';
import { PassportIssue, type IssueHost } from './passport-issue';
import type { Doc } from './passport-consts';

function productHost() {
  const product: Doc = { _id: new Types.ObjectId(), name: 'Урна', dimensions: { length: 100, width: 200, height: 300, unit: 'мм' }, __v: 0, updatedAt: new Date(0) };
  const session = { withTransaction: async (run: () => Promise<void>) => run(), endSession: jest.fn() };
  const findOne = jest.fn(async () => ({ ...product }));
  const updateOne = jest.fn(async () => { product.__v = Number(product.__v) + 1; product.updatedAt = new Date(); return { matchedCount: 1 }; });
  const connection = { db: { collection: () => ({ findOne, updateOne }) }, startSession: async () => session } as unknown as Connection;
  return { product, session, findOne, updateOne, connection };
}

describe('C172 release: бизнес-источник и технический guard различаются', () => {
  it('две подготовки одного изделия: собственный touch не блокирует одинаковый ключ/другую позицию', async () => {
    const h = productHost();
    const first = await passportProductVersion(h.connection, h.product._id);
    const second = await passportProductVersion(h.connection, h.product._id);
    const ownAction = jest.fn(async () => 'первая позиция');
    const otherAction = jest.fn(async () => 'другая позиция');
    await expect(withPassportProductWrite(h.connection, first, undefined, ownAction)).resolves.toBe('первая позиция');
    await expect(withPassportProductWrite(h.connection, second, undefined, otherAction)).resolves.toBe('другая позиция');
    expect(h.updateOne).toHaveBeenCalledTimes(2);
    expect(h.findOne).toHaveBeenLastCalledWith({ _id: h.product._id, deletedAt: null }, { session: h.session });
  });
  it('unique победителя не маскируется product409 и доходит до existing replay вызывающего сервиса', async () => {
    const h = productHost(), baseline = await passportProductVersion(h.connection, h.product._id);
    await withPassportProductWrite(h.connection, baseline, undefined, async () => undefined);
    const duplicate = Object.assign(new Error('winner'), { code: 11000 });
    await expect(withPassportProductWrite(h.connection, baseline, undefined, async () => { throw duplicate; })).rejects.toBe(duplicate);
  });
  it.each(['dimensions', 'passportDefaults', 'deletedAt'] as const)('реальное изменение %s сохраняет stale409 до вставки', async field => {
    const h = productHost(), baseline = await passportProductVersion(h.connection, h.product._id);
    h.product[field] = field === 'deletedAt' ? new Date() : { changed: true };
    const insert = jest.fn();
    await expect(withPassportProductWrite(h.connection, baseline, undefined, insert)).rejects.toThrow('Изделие изменилось');
    expect(insert).not.toHaveBeenCalled(); expect(h.updateOne).not.toHaveBeenCalled();
  });
  it('порядок ключей nested BSON не меняет отпечаток, родительская session повторно не открывается', async () => {
    const h = productHost(), baseline = await passportProductVersion(h.connection, h.product._id);
    h.product.dimensions = { unit: 'мм', height: 300, width: 200, length: 100 };
    await expect(withPassportProductWrite(h.connection, baseline, h.session as never, async s => s)).resolves.toBe(h.session);
    expect(h.session.endSession).not.toHaveBeenCalled();
  });
});

describe('C172 release: legacy issue замораживает рисунки внутри transaction', () => {
  function legacy(missing = false) {
    const oldPhoto = new Types.ObjectId(), newPhoto = new Types.ObjectId();
    const state: Doc = { _id: new Types.ObjectId(), productId: new Types.ObjectId(), status: 'draft', passportNumber: 'draft-test', name: 'Своё имя', textSnapshot: { sections: [], privateText: 'Свой текст' }, images: [{ kind: 'overview', photoId: oldPhoto }] };
    const beforeText = state.textSnapshot;
    const session = { withTransaction: async (run: () => Promise<void>) => run(), endSession: jest.fn() };
    const chain = { session: () => chain, lean: () => chain, exec: async () => ({ ...state }) };
    const write = jest.fn(async (_q: unknown, update: { $set: Doc }) => Object.assign(state, update.$set));
    const effectiveImages = jest.fn(async (_doc: Doc, seen: unknown) => { expect(seen).toBe(session); return [{ kind: 'overview', photoId: newPhoto }]; });
    const readiness = jest.fn(async (doc: Doc, seen?: unknown) => {
      if (!seen) return [];
      expect(seen).toBe(session); expect(doc.images).toEqual([{ kind: 'overview', photoId: newPhoto }]);
      return missing ? [{ key: 'img_overview', label: 'Рисунок отсутствует' }] : [];
    });
    const freezeImages = jest.fn(async () => undefined);
    const h: IssueHost = {
      connection: { startSession: async () => session, db: { collection: () => ({ updateOne: async () => ({ matchedCount: 1 }) }) } } as never,
      model: { findOne: () => chain, updateOne: (...args: Parameters<typeof write>) => ({ exec: () => write(...args) }) } as never,
      findById: async () => ({ toObject: () => ({ ...state }) }) as never,
      readiness, effectiveImages, freezeImages, refresh: async () => undefined,
      allocate: async set => { set.passportNumber = '618'; }, assertFree: async () => undefined,
    };
    return { issue: new PassportIssue(h), state, newPhoto, readiness, effectiveImages, freezeImages, write, session, beforeText };
  }
  it('изменившийся после preflight рисунок попадает в выпущенный own images; текст и имя прежние', async () => {
    const h = legacy();
    await h.issue.issue(String(h.state._id));
    expect(h.state).toMatchObject({ status: 'issued', passportNumber: '618', name: 'Своё имя', images: [{ kind: 'overview', photoId: h.newPhoto }] });
    expect(h.state.textSnapshot).toBe(h.beforeText); expect(h.effectiveImages).toHaveBeenCalledTimes(1);
    expect(h.freezeImages).not.toHaveBeenCalled(); expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.session.endSession).toHaveBeenCalledTimes(1);
  });
  it('проверяется новый набор: отсутствие рисунка не оставляет номер/issued', async () => {
    const h = legacy(true);
    await expect(h.issue.issue(String(h.state._id))).rejects.toThrow('Данные паспорта изменились');
    expect(h.state.status).toBe('draft'); expect(h.state.passportNumber).toBe('draft-test');
    expect(h.write).not.toHaveBeenCalled(); expect(h.freezeImages).not.toHaveBeenCalled();
  });
});
