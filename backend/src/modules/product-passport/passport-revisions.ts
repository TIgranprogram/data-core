import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Doc } from './passport-consts';

/** Версия выпущенного паспорта в списке карточки: без снимка текста (он тяжёлый). */
export type RevisionRow = { revision: number; at: Date | null; by: string | null; byName: string | null; current: boolean };

/** Список версий: прежние из revisions[] + текущая; новые сверху. `names` — id пользователя → имя. */
export function revisionRows(doc: Doc, names: Map<string, string>): RevisionRow[] {
  if (!Array.isArray(doc.revisions) || !doc.revisions.length) return [];
  const cur = Number(doc.revision ?? 1);
  const rows: RevisionRow[] = (doc.revisions as Array<Record<string, unknown>>).map((r) => ({
    revision: Number(r.revision), at: (r.at as Date) ?? null, by: r.by ? String(r.by) : null, byName: r.by ? names.get(String(r.by)) ?? null : null, current: false,
  }));
  rows.push({ revision: cur, at: (doc.updatedAt as Date) ?? null, by: null, byName: null, current: true });
  return rows.sort((a, b) => b.revision - a.revision);
}

/** Удалить можно только прежнюю версию: текущая печатается, её убрать нельзя. */
export function assertRevisionRemovable(doc: Doc, revision: number): void {
  if (!Number.isInteger(revision) || revision < 1) throw new BadRequestException('Номер версии — целое число от 1');
  if (revision >= Number(doc.revision ?? 1)) throw new ConflictException('Текущую версию удалить нельзя — она печатается');
  const has = ((doc.revisions as Array<Record<string, unknown>>) ?? []).some((r) => Number(r.revision) === revision);
  if (!has) throw new NotFoundException(`Версия ${revision} не найдена`);
}
