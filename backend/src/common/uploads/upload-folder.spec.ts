import { join, resolve } from 'path';
import { safeUploadPath } from './safe-path';
import { uploadFolderOf, uploadSubdir } from './upload-folder';

describe('папки загрузок', () => {
  it('назначение и месяц', () => {
    expect(uploadSubdir('passport', new Date('2026-11-01T10:00:00Z'))).toBe('passport/2026-11');
    expect(uploadSubdir('supply', new Date('2026-01-31T23:00:00Z'))).toBe('supply/2026-01');
  });
  it('чужое назначение и обход пути — other', () => {
    expect(uploadFolderOf('../etc')).toBe('other');
    expect(uploadFolderOf(undefined)).toBe('other');
    expect(uploadSubdir('../../x')).toMatch(/^other\/\d{4}-\d{2}$/);
  });
  it('safeUploadPath читает подпапки и по-прежнему отсекает «..»', () => {
    const root = resolve('/data/uploads');
    expect(safeUploadPath('/uploads/passport/2026-11/a.jpg', root)).toBe(join(root, 'passport', '2026-11', 'a.jpg'));
    expect(safeUploadPath('/uploads/passport/../../etc/passwd', root)).toBeNull();
    expect(safeUploadPath('/uploads/a.jpg', root)).toBe(join(root, 'a.jpg'));
  });
});
