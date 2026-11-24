import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Каталог шрифтов ГОСТ (`pwa/fonts/gost-a.ttf`). Только путь, без правил документов.
 * Файл лежит на два уровня под `src/` или `dist/` — как прежний `passport-pdf`,
 * поэтому относительные кандидаты те же: cwd `backend/`, соседний `pwa/fonts`, корень репозитория.
 */
export function fontDir(): string {
  const c = [
    join(process.cwd(), 'pwa', 'fonts'),
    join(__dirname, '..', '..', '..', 'pwa', 'fonts'),
    join(__dirname, '..', '..', '..', '..', 'pwa', 'fonts'),
  ];
  return c.find((p) => existsSync(join(p, 'gost-a.ttf'))) ?? c[0];
}
