import { BadRequestException } from '@nestjs/common';
import { DictsService } from './dicts.service';
import { DICT, type Doc } from './dicts.defs';

/** ПВ2: код записи справочника паспортов не меняется; у новой — из названия; служебные поля не попадают в столбцы. */
describe('справочники «Паспорта»: код и служебные поля', () => {
  const svc = Object.create(DictsService.prototype) as unknown as {
    withCode(d: unknown, b: Record<string, unknown>): Promise<Record<string, unknown>>;
    lockedCode(d: unknown, cur: Doc, b: Record<string, unknown>): Record<string, unknown>;
    docs: (d: unknown) => Promise<Doc[]>;
  };
  const mats = DICT.get('passportMaterials')!;

  it('PATCH с другим кодом — 400, с тем же или без кода — можно', () => {
    const cur = { _id: 1, code: 'STEEL' } as unknown as Doc;
    expect(() => svc.lockedCode(mats, cur, { code: 'OTHER' })).toThrow(BadRequestException);
    expect(() => svc.lockedCode(mats, cur, { code: ' STEEL ' })).not.toThrow();
    expect(svc.lockedCode(mats, cur, { name: 'x' }).code).toBe('STEEL');
  });
  it('у старой записи без кода код можно задать', () => {
    expect(svc.lockedCode(mats, { _id: 1 } as unknown as Doc, { code: 'NEW' }).code).toBe('NEW');
  });
  it('POST без кода: код из названия, уникальный (_2)', async () => {
    svc.docs = async () => [{ code: 'STAL_TRUBA' } as unknown as Doc];
    expect((await svc.withCode(mats, { name: 'Сталь труба' })).code).toBe('STAL_TRUBA_2');
    expect((await svc.withCode(mats, { name: 'Алюминий' })).code).toBe('ALYUMINIY');
    expect((await svc.withCode(mats, { name: 'Алюминий', code: 'AL' })).code).toBe('AL');
  });
  it('справочник без lockAfterCreate код не трогает', async () => {
    expect(await svc.withCode(DICT.get('units')!, { name: 'шт' })).toEqual({ name: 'шт' });
  });
  it('tech-поля не попадают в столбцы; у «Нормативов» — статус и «Проверено»', () => {
    for (const d of DICT.values()) {
      const tech = new Set(d.fields.filter((f) => f.tech).map((f) => f.key));
      expect(d.columns.filter((c) => tech.has(c.key))).toEqual([]);
    }
    const st = DICT.get('passportStandards')!;
    expect(st.columns.map((c) => c.key)).toEqual(['status', 'checkedAt']);
    expect(st.fields[0].label).toBe('Обозначение (коротко)');
    expect(st.fields.find((f) => f.key === 'code')).toMatchObject({ tech: true, lockAfterCreate: true });
  });
  it('ref-поля: пять из ТЗ + дефекты', () => {
    const ref = (k: string, f: string) => DICT.get(k)!.fields.find((x) => x.key === f)!.ref;
    expect(ref('passportDefects', 'applies')).toMatchObject({ dict: 'passportElements,passportMaterials' });
    expect(ref('passportElements', 'standard')).toEqual({ dict: 'passportStandards', multiple: false });
    expect(ref('passportSortament', 'material')).toEqual({ dict: 'passportMaterials', multiple: false });
  });
});
