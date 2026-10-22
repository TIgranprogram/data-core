import { BadRequestException } from '@nestjs/common';

/**
 * Правка абзаца только для этого паспорта (БЗ-6 Э5a3): меняется текст пункта в снимке `textSnapshot`, справочники и
 * шаблоны не трогаются. Пункт помечается `edited` (с исходным текстом в `original`) — чтобы «Обновить текст по
 * справочникам» мог предупредить, что ручные правки пропадут, и чтобы правку можно было перенести в справочник.
 */
export interface SnapshotItem { key: string; number: string | null; text: string; bullet: boolean; edited?: boolean; original?: string }
export interface SnapshotSection { key: string; number: string; title: string; items: SnapshotItem[] }

export function editSnapshotItem(sections: SnapshotSection[], sectionKey: string, itemKey: string, text: string): SnapshotSection[] {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new BadRequestException('Текст пункта не может быть пустым');
  if (t.length > 4000) throw new BadRequestException('Пункт длиннее 4000 знаков');
  let found = false;
  const next = sections.map((s) => (s.key !== sectionKey ? s : {
    ...s,
    items: s.items.map((i) => {
      if (i.key !== itemKey) return i;
      found = true;
      const original = i.edited ? i.original : i.text;
      return t === original ? { key: i.key, number: i.number, text: t, bullet: i.bullet } : { ...i, text: t, edited: true, original };
    }),
  }));
  if (!found) throw new BadRequestException('Пункт не найден в тексте паспорта — обновите карточку');
  return next;
}
