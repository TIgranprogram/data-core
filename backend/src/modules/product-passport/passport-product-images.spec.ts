import { mergeProductImages } from './passport-product-images';

describe('mergeProductImages', () => {
  const own = [{ kind: 'overview', photoId: 'o1', order: 0 }, { kind: 'dimensions', photoId: 'd1', order: 1 }, { kind: 'safety', photoId: 's1', order: 2 }];
  it('вид из изделия вытесняет такой же вид паспорта, остальные виды остаются', () => {
    const r = mergeProductImages([{ kind: 'overview', photoId: 'p1', sortOrder: 0 }], own);
    expect(r.map((x) => `${x.kind}:${x.photoId}`)).toEqual(['overview:p1', 'dimensions:d1', 'safety:s1']);
  });
  it('safety паспорта и safety_zone изделия — один вид', () => {
    const r = mergeProductImages([{ kind: 'safety_zone', photoId: 'z1', sortOrder: 0, caption: 'Зона' }], own);
    expect(r.some((x) => x.photoId === 's1')).toBe(false);
    expect(r.find((x) => x.photoId === 'z1')).toMatchObject({ kind: 'safety_zone', caption: 'Зона' });
  });
  it('в изделии нет рисунков — как раньше, images[] паспорта', () => {
    expect(mergeProductImages([], own)).toEqual(own);
    expect(mergeProductImages([{ kind: 'holes', photoId: null }], own)).toEqual(own);
  });
  it('несколько рисунков одного вида идут по sortOrder изделия', () => {
    const r = mergeProductImages([{ kind: 'assembly', photoId: 'a2', sortOrder: 1 }, { kind: 'assembly', photoId: 'a1', sortOrder: 0 }], []);
    expect(r.map((x) => x.order)).toEqual([1, 0]);
  });
});
