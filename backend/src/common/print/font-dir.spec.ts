import { existsSync } from 'fs';
import { join } from 'path';
import { fontDir } from './font-dir';

describe('fontDir', () => {
  it('находит каталог с gost-a.ttf', () => {
    const dir = fontDir();
    expect(existsSync(join(dir, 'gost-a.ttf'))).toBe(true);
    expect(existsSync(join(dir, 'gost-a-slanted.ttf'))).toBe(true);
  });
});
