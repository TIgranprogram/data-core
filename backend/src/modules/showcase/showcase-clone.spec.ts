import { Types } from 'mongoose';
import { cloneDoc } from './showcase-clone';

/** Клон изделия (ПВ): что переходит, что нет. */
describe('cloneDoc', () => {
  const photo = new Types.ObjectId(), cat = new Types.ObjectId();
  const src = { _id: new Types.ObjectId(), sku: '1201', name: 'Турник', kind: 'good', unit: 'шт', listPrice: 1000, categoryId: cat, photoIds: [photo], mainPhotoId: photo, colors: ['красный'],
    passportDefaults: { passportCategory: 'TRN', textChoices: { a: 'b' } }, materialsSpec: { rows: [] }, composition: [{ lineType: 'material' }], stockQty: 7, hasPassport: true, deletedAt: new Date(), createdAt: new Date(0), source: 'crm' };
  const now = new Date('2026-10-25');
  const c = cloneDoc(src as never, '1202', now);

  it('имя «… (копия)», новый артикул, новая дата, не в корзине, источник — витрина', () => {
    expect(c).toEqual(expect.objectContaining({ sku: '1202', name: 'Турник (копия)', deletedAt: null, source: 'showcase', createdAt: now, updatedAt: now }));
    expect('_id' in c).toBe(false);
  });
  it('поля, фото, состав и значения паспорта (с выбором текстов) переходят; ObjectId остаются ObjectId', () => {
    expect(c.passportDefaults).toEqual({ passportCategory: 'TRN', textChoices: { a: 'b' } });
    expect(c.materialsSpec).toEqual({ rows: [] });
    expect(c.composition).toEqual([{ lineType: 'material' }]);
    expect(c.colors).toEqual(['красный']);
    expect(c.categoryId).toBeInstanceOf(Types.ObjectId);
    expect((c.photoIds as Types.ObjectId[])[0]).toBeInstanceOf(Types.ObjectId);
    expect(String(c.mainPhotoId)).toBe(String(photo));
  });
  it('склад и признак «есть паспорт» исходного не переходят', () => {
    expect(c.stockQty).toBe(0);
    expect(c.hasPassport).toBe(false);
  });
});
