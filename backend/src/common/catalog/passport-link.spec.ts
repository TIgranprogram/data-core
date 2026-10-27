import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { mergePassportSpec, presentPassportSpec } from './passport-link';

describe('passport-spec (МЦ-2/МЦ-6)', () => {
  const m = new Types.ObjectId();
  it('связь: id, размеры в одном написании без дублей, покрытие', () => {
    const r = mergePassportSpec(null, { materialId: String(m), sizes: ['89х3', '89x3 мм'], isCoating: false })!;
    expect(String(r.materialId)).toBe(String(m));
    expect(r.sizes?.length).toBe(1);
    expect(r.isCoating).toBeUndefined();
  });
  it('переданные ключи заменяют, остальные (тексты) остаются', () => {
    const cur = { materialId: m, passportText: 'Текст' };
    const r = mergePassportSpec(cur, { sizes: ['2'] })!;
    expect(r.passportText).toBe('Текст');
    expect(r.sizes).toEqual(['2']);
  });
  it('materialId: null снимает связь, тексты остаются; пусто совсем — null', () => {
    const r = mergePassportSpec({ materialId: m, sizes: ['2'], techText: 'ТТ' }, { materialId: null })!;
    expect(r).toEqual({ techText: 'ТТ' });
    expect(mergePassportSpec({ materialId: m }, { materialId: null })).toBeNull();
  });
  it('ошибки: не id, размеры без материала, длинный текст', () => {
    expect(() => mergePassportSpec(null, { materialId: 'x' })).toThrow(BadRequestException);
    expect(() => mergePassportSpec(null, { sizes: ['2'] })).toThrow(BadRequestException);
    expect(() => mergePassportSpec(null, { passportText: 'я'.repeat(2001) })).toThrow(BadRequestException);
  });
  it('списки без текстов', () => {
    const sp = { materialId: m, passportText: 'А', techText: 'Б' };
    expect(presentPassportSpec(sp, false)).toEqual({ materialId: String(m) });
    expect(presentPassportSpec(sp)?.techText).toBe('Б');
    expect(presentPassportSpec(undefined)).toBeNull();
  });
});
