import { snapshotRevisionPatch } from './passport-snapshot-revision';

describe('C178: локальная редакция снимка выпущенного паспорта', () => {
  const before = () => ({ status: 'issued', revision: 3, passportNumber: '178', productCode: 'И178', name: 'Прежнее название',
    textSnapshot: { sections: [], description: 'Прежний текст', choices: {}, at: new Date(1) },
    images: [{ kind: 'overview', photoId: 'photo' }], printSnapshot: { org: { name: 'Замороженная фирма' }, style: { color: '#123456' } },
    revisions: [{ revision: 2, data: { name: 'Ещё раньше' } }],
  });
  it('создаёт полную прежнюю печатную проекцию и сохраняет автора без рекурсивной истории', () => {
    const p = before(), next = { ...p.textSnapshot, description: 'Новый текст' };
    const patch = snapshotRevisionPatch(p, next, 'actor')!;
    expect(patch.revision).toBe(4); expect(patch.revisions).toHaveLength(2);
    const row = (patch.revisions as Array<Record<string, unknown>>)[1];
    expect(row).toMatchObject({ revision: 3, by: 'actor', data: { name: p.name, passportNumber: '178', textSnapshot: p.textSnapshot, printSnapshot: p.printSnapshot, images: p.images } });
    expect((row.data as Record<string, unknown>).revisions).toBeUndefined();
    expect(p.textSnapshot.description).toBe('Прежний текст'); expect(p.revisions).toHaveLength(1);
    expect(patch.printSnapshot).toBeUndefined(); // Словари, стиль, фирма и схемы не перечитываются.
  });
  it('samevalue и служебное время не порождают сохранение/редакцию', () => {
    const p = before(); expect(snapshotRevisionPatch(p, { ...p.textSnapshot, at: new Date(), editedAt: new Date() })).toBeNull();
  });
  it('черновик меняет только снимок, аннулированный запрещён даже без изменения', () => {
    const p = before(); expect(snapshotRevisionPatch({ ...p, status: 'draft' }, { ...p.textSnapshot, purpose: 'Новое' })).not.toHaveProperty('revision');
    expect(() => snapshotRevisionPatch({ ...p, status: 'annulled' }, p.textSnapshot)).toThrow('аннулирован');
  });
  it('локальное краткое описание становится собственным текстом экземпляра для следующих CAD редакций', () => {
    const p = { ...before(), presentationVersion: 1, variant: 'short', simpleDescription: { mode: 'parts', partIds: ['part'] } };
    expect(snapshotRevisionPatch(p, { ...p.textSnapshot, description: 'Свой текст' })).toMatchObject({
      simpleDescription: { text: 'Свой текст', partIds: ['part'] }, textSnapshot: { simpleDescriptionSource: { kind: 'own', partIds: ['part'] } },
    });
  });
  it('старый выпущенный паспорт без статуса/редакции получает редакцию2 и историю1', () => {
    const p = { ...before(), status: undefined, revision: undefined };
    expect(snapshotRevisionPatch(p, { ...p.textSnapshot, purpose: 'Иное' })).toMatchObject({ revision: 2, revisions: expect.arrayContaining([expect.objectContaining({ revision: 1 })]) });
  });
});
