import { identifyProduct, type IdentificationContext } from './showcase-identification';
import { bulkExpected, bulkFingerprint } from './showcase-bulk-cas';
import { Types } from 'mongoose';

describe('C176: единое разрешение идентификации', () => {
  const context = (): IdentificationContext => ({
    groups: new Map([['root', { _id: 'root', name: 'Благоустройство', passportCategory: 'BLG' }], ['group', { _id: 'group', name: 'Скамьи', parentId: 'root', passportKindId: 'bench' }]]),
    kinds: new Map([['bench', { id: 'bench', name: 'Скамьи', passportCategory: 'BLG', elementIds: [], purposeLeafId: '' }]]),
    categories: [{ code: 'BLG', name: 'Благоустройство' }],
  });
  it('живой вид группы закрывает отсутствующий или битый собственный', () => {
    for (const kindId of [undefined, 'deleted']) {
      const row = identifyProduct({ categoryId: 'group', passportDefaults: { kindId } }, context());
      expect(row.issues).toEqual([]); expect(row.kind.source).toBe('group');
    }
  });
  it('свой вид главнее группы и поддерживает MAF→BLG', () => {
    const row = identifyProduct({ categoryId: 'group', passportDefaults: { kindId: 'bench', passportCategory: 'MAF' } }, context());
    expect(row.issues).toEqual([]); expect(row.kind.source).toBe('own');
  });
  it('неизвестный непустой код не означает валидную категорию', () => {
    expect(identifyProduct({ categoryId: 'group', passportDefaults: { passportCategory: 'unknown' } }, context()).issues.map(i => i.key)).toEqual(['passportCategory']);
  });
  it('раздел без группы не выдаётся за выбранную группу', () => {
    expect(identifyProduct({ categoryId: 'root', passportDefaults: { kindId: 'bench' } }, context()).issues.map(i => i.key)).toEqual(['group']);
  });
  it('удалённый родитель/группа и вид дают адресные причины без исключения', () => {
    const c = context(); c.groups.delete('root'); c.kinds.clear();
    expect(identifyProduct({ categoryId: 'group' }, c).issues.map(i => i.key)).toEqual(['group', 'kind', 'passportCategory']);
    expect(identifyProduct({ categoryId: 'not-an-object-id' }, c).issues).toHaveLength(3);
  });
  it('неподходящая чужая группа не отменяет живой собственный вид', () => {
    const c = context(); c.groups.delete('group');
    expect(identifyProduct({ categoryId: 'group', passportDefaults: { kindId: 'bench' } }, c).issues.map(i => i.key)).toEqual(['group']);
  });
  it('квитанция отмены стабильна между BSON и JSON, но меняется при конкурентном вводе', () => {
    const id = new Types.ObjectId();
    const row = { categoryId: id, passportDefaults: { kindId: id, maxUsers: 2 } };
    expect(bulkFingerprint(row, ['categoryId', 'passportDefaults'])).toBe(bulkFingerprint(JSON.parse(JSON.stringify(row)), ['passportDefaults', 'categoryId']));
    expect(bulkFingerprint(row, ['passportDefaults'])).not.toBe(bulkFingerprint({ ...row, passportDefaults: { ...row.passportDefaults, maxUsers: 3 } }, ['passportDefaults']));
    expect(bulkExpected({}, ['series'])).toEqual({ series: { $exists: false } });
  });
});
