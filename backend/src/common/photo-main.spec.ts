import { Types } from 'mongoose';
import { photoToFront } from './photo-main';

/** «Сделать главным»: фото переезжает в начало photoIds; чужое фото — 404 без записи. */
describe('photoToFront', () => {
  const a = new Types.ObjectId(), b = new Types.ObjectId(), c = new Types.ObjectId();
  const store = () => {
    const doc = { photoIds: [a, b, c] };
    const update = async (f: Record<string, unknown>, u: Record<string, any>) => {
      if (f.photoIds && !doc.photoIds.some((x) => x.equals(f.photoIds as Types.ObjectId))) return { matchedCount: 0, modifiedCount: 0 };
      if (u.$pull) doc.photoIds = doc.photoIds.filter((x) => !x.equals(u.$pull.photoIds));
      if (u.$push) doc.photoIds.splice(u.$push.photoIds.$position, 0, ...u.$push.photoIds.$each);
      return { matchedCount: 1, modifiedCount: 1 };
    };
    return { doc, update };
  };
  it('третье фото становится первым, остальные по порядку', async () => {
    const { doc, update } = store();
    await photoToFront(update, { _id: 1 }, c);
    expect(doc.photoIds).toEqual([c, a, b]);
  });
  it('фото не из записи — 404, список не меняется', async () => {
    const { doc, update } = store();
    await expect(photoToFront(update, { _id: 1 }, new Types.ObjectId())).rejects.toThrow('не найдено');
    expect(doc.photoIds).toEqual([a, b, c]);
  });
});
