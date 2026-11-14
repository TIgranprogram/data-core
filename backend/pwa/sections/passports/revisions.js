import { api } from '../../core/api.js';
import { date } from '../../core/format.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, section, table } from '../../ui/kit/index.js';
import { canWorkPassport } from './common.js';

/** Версии выпущенного паспорта: правки хранятся версиями, печатается последняя; прежние можно удалить. Нет правок — блока нет. */
export function revisionsBlock(r, ctx) {
  const list = r.revisionList || [];
  if (!list.length) return null;
  const remove = async (v) => {
    if (!(await confirmDlg(`Удалить версию ${v.revision}?`, 'Прежние значения этой версии пропадут. Печать и номер не изменятся.', { okText: 'Удалить' }))) return;
    try {
      ctx.setRow(await api(`/passports/${r.id}/revisions/${v.revision}`, { method: 'DELETE' }));
      toast(`Версия ${v.revision} удалена`);
    } catch (e) { toastError(e, 'удалить версию'); }
  };
  const mayDelete = canWorkPassport();
  return section({ title: 'Версии паспорта', tone: 'info', count: list.length, body: [
    table({ label: 'Версии паспорта', columns: [{ label: 'Версия' }, { label: 'Дата' }, { label: 'Кто', hide: true }, { label: '' }],
      rows: list.map((v) => ({ cells: [
        v.current ? `Версия ${v.revision} · печатается` : `Версия ${v.revision}`,
        v.at ? date(v.at) : '',
        v.byName || '',
        !v.current && mayDelete ? button({ label: 'Удалить', kind: 'ghost', size: 'S', onClick: () => remove(v) }) : '',
      ] })) }),
  ] });
}
