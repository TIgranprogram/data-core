import { ConflictException } from '@nestjs/common';
import { copyPassportValue } from '../../common/passport/line-source';
import { isIssued, type Doc } from './passport-consts';
import { isBriefPresentation } from './passport-presentation';
import { sameSnapshot, type Snap } from './passport-snapshot-refresh';

/** Только локальный текст: печатные источники остаются замороженными, PDF берёт новый textSnapshot. */
export function snapshotRevisionPatch(previous: Doc, next: Snap, by?: string): Doc | null {
  if (previous.status === 'annulled') throw new ConflictException('Паспорт аннулирован — изменить его нельзя');
  if (sameSnapshot(previous.textSnapshot as Snap | undefined, next)) return null;
  const textSnapshot: Snap = { ...copyPassportValue(next), editedAt: new Date() };
  const patch: Doc = { textSnapshot };
  if (!isIssued(previous)) return patch;
  // Полная прежняя проекция; revisions исключены, чтобы история не росла рекурсивно.
  const data = copyPassportValue(Object.fromEntries(Object.entries(previous).filter(([key]) => !['revisions', '__v', 'createdAt', 'updatedAt'].includes(key))));
  patch.revisions = [...((previous.revisions as unknown[]) ?? []), { revision: previous.revision ?? 1, at: new Date(), by: by ?? null, data }];
  patch.revision = Number(previous.revision ?? 1) + 1;
  if (isBriefPresentation(previous) && next.description !== (previous.textSnapshot as Snap | undefined)?.description) {
    const oldSource = (previous.textSnapshot as { simpleDescriptionSource?: { partIds?: unknown[] } } | undefined)?.simpleDescriptionSource;
    const partIds = ((previous.simpleDescription as { partIds?: unknown[] } | undefined)?.partIds ?? oldSource?.partIds ?? []).map(String);
    patch.simpleDescription = { text: String(next.description ?? ''), partIds };
    textSnapshot.simpleDescriptionSource = { kind: 'own', partIds };
  }
  return patch;
}
