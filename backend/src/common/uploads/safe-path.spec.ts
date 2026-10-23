import { join, resolve } from 'path';
import { safeUploadPath } from './safe-path';

describe('safeUploadPath — ссылка из базы не выводит за папку загрузок (М1)', () => {
  const root = resolve('/srv/uploads');

  it('обычный файл и подпапка — путь внутри папки', () => {
    expect(safeUploadPath('/uploads/abc-1.png', root)).toBe(join(root, 'abc-1.png'));
    expect(safeUploadPath('/uploads/doc/x_2.pdf', root)).toBe(join(root, 'doc', 'x_2.pdf'));
  });

  it('выход за папку и подделки — null', () => {
    for (const bad of ['/uploads/../etc/passwd', '../x.png', '/uploads/a/../../x', '/uploads/%2e%2e/x', '/uploads/..%2fx', '/uploads/a\\..\\x', '/etc/passwd', '/uploads/', '', null, undefined, 42]) {
      expect(safeUploadPath(bad, root)).toBeNull();
    }
  });
});
