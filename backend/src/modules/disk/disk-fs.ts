import { promises as fs } from 'fs';
import path from 'path';

/** Сколько файлов обходить при подсчёте размера папки (фото — десятки тысяч, этого хватает). */
const WALK_LIMIT = 300_000;

/** Размер папки: обход без перехода по ссылкам; нечитаемое пропускается. partial — упёрлись в лимит. */
export async function dirSize(dir: string) {
  let bytes = 0, files = 0, partial = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let list;
    try { list = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      if (files >= WALK_LIMIT) { partial = true; break; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += (await fs.stat(p)).size; files++; } catch { /* удалён на ходу */ } }
    }
  }
  return { bytes, files, partial };
}
export const exists = (p: string) => fs.access(p).then(() => true, () => false);
