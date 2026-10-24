import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MaterialsSpecRefs, parseMaterialsSpec, presentMaterialsSpec } from './materials-table';

/** МИ.2: `products.materialsSpec` / `productpassports.materialsSpec` — разбор тела запроса, ответ API, проверка ссылок на справочники. */
const id = () => new Types.ObjectId();
describe('materialsSpec изделия и паспорта', () => {
  const pipe = id(), post = id(), powder = id(), wood = id();
  it('тело → запись: размеры одним написанием без дублей, пустые строки пропускаются, покрытий несколько', () => {
    const sp = parseMaterialsSpec({ rows: [
      { materialId: String(pipe), sizes: ['Ø89x3 мм', '∅89×3', ' '], partIds: [String(post), String(post)] },
      { materialId: '', sizes: [], partIds: [] },
    ], coatingIds: [String(powder), String(wood)] })!;
    expect(sp.rows).toHaveLength(1);
    expect(sp.rows[0].materialId.equals(pipe)).toBe(true);
    expect(sp.rows[0].sizes).toEqual(['∅89×3']);
    expect(sp.rows[0].partIds.map(String)).toEqual([String(post)]);
    expect(sp.coatingIds.map(String)).toEqual([String(powder), String(wood)]);
    expect(presentMaterialsSpec(sp)).toEqual({ rows: [{ materialId: String(pipe), sizes: ['∅89×3'], partIds: [String(post)] }], coatingIds: [String(powder), String(wood)] });
  });
  it('пусто / null — снять поле (null); ответ без поля — null', () => {
    expect(parseMaterialsSpec(null)).toBeNull();
    expect(parseMaterialsSpec({ rows: [], coatingIds: [] })).toBeNull();
    expect(presentMaterialsSpec(undefined)).toBeNull();
  });
  it('ошибки ввода — 400 по-русски', () => {
    expect(() => parseMaterialsSpec({ rows: [{ sizes: ['2'] }] })).toThrow('Строка 1: выберите материал');
    expect(() => parseMaterialsSpec({ rows: [{ materialId: 'мусор' }] })).toThrow(BadRequestException);
    expect(() => parseMaterialsSpec({ rows: 'труба' })).toThrow(BadRequestException);
    expect(() => parseMaterialsSpec({ coatingIds: ['x'] })).toThrow(BadRequestException);
    expect(() => parseMaterialsSpec({ rows: Array.from({ length: 51 }, () => ({ materialId: String(pipe) })) })).toThrow(BadRequestException);
  });
  it('ссылки — только на живые записи справочников', async () => {
    const live = [{ _id: pipe, dict: 'passportMaterials' }, { _id: post, dict: 'passportParts' }];
    const db = { collection: () => ({ find: (q: { dict: string; _id: { $in: Types.ObjectId[] } }) => ({ toArray: async () => live.filter((x) => x.dict === q.dict && q._id.$in.some((i) => i.equals(x._id))) }) }) };
    const mi = new MaterialsSpecRefs(() => db as never);
    await expect(mi.check(parseMaterialsSpec({ rows: [{ materialId: String(pipe), partIds: [String(post)] }] }))).resolves.toBeUndefined();
    await expect(mi.check(parseMaterialsSpec({ rows: [{ materialId: String(pipe) }], coatingIds: [String(powder)] }))).rejects.toThrow('«Материалы и покрытия»');
    await expect(mi.check(parseMaterialsSpec({ rows: [{ materialId: String(pipe), partIds: [String(wood)] }] }))).rejects.toThrow('«Части изделия»');
  });
});
