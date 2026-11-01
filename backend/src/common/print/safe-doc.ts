import { Logger } from '@nestjs/common';
import { printSafe } from './fill-text';

const log = new Logger('print');

/**
 * Предохранитель печати: каждый doc.text() проходит printSafe — «{метка}», undefined, null, NaN не попадают в PDF.
 * Вызывать сразу после `new PDFDocument(...)`. `what` — название документа для лога.
 */
export function guardDoc<T extends { text: (...a: never[]) => unknown }>(doc: T, what: string): T {
  const orig = doc.text as (...a: unknown[]) => unknown;
  (doc as { text: unknown }).text = function (this: unknown, t: unknown, ...rest: unknown[]) {
    return orig.call(doc, printSafe(t, (found) => log.warn(`${what}: в печать просилось ${found.join(', ')} — заменено линией`)), ...rest);
  };
  return doc;
}
