import { BadRequestException } from '@nestjs/common';
import { editSnapshotItem, editedCount, type SnapshotSection } from './passport-snapshot-edit';

/** Правка абзаца для одного паспорта (БЗ-6 Э5a3). */
describe('editSnapshotItem', () => {
  const base: SnapshotSection[] = [{ key: 'warranty', number: '4', title: 'Гарантия', items: [{ key: 'p1', number: '4.1', text: 'Гарантия 12 мес.', bullet: false }, { key: 'p2', number: '4.2', text: 'Второй', bullet: false }] }];
  it('меняет текст пункта, помечает правку и хранит исходный', () => {
    const r = editSnapshotItem(base, 'warranty', 'p1', '  Гарантия   24 мес. ');
    expect(r[0].items[0]).toEqual(expect.objectContaining({ text: 'Гарантия 24 мес.', edited: true, original: 'Гарантия 12 мес.' }));
    expect(r[0].items[1]).toBe(base[0].items[1]);
    expect(editedCount(r)).toBe(1);
    // повторная правка — исходный остаётся первым; возврат к исходному — пометка снимается
    const r2 = editSnapshotItem(r, 'warranty', 'p1', 'Гарантия 36 мес.');
    expect(r2[0].items[0].original).toBe('Гарантия 12 мес.');
    const r3 = editSnapshotItem(r2, 'warranty', 'p1', 'Гарантия 12 мес.');
    expect(r3[0].items[0].edited).toBeUndefined();
    expect(editedCount(r3)).toBe(0);
  });
  it('пустой текст и чужой пункт — 400', () => {
    expect(() => editSnapshotItem(base, 'warranty', 'p1', '  ')).toThrow(BadRequestException);
    expect(() => editSnapshotItem(base, 'warranty', 'p9', 'x')).toThrow(BadRequestException);
  });
});
