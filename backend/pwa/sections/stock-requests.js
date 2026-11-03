import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { qty as fmt, date } from '../core/format.js';
import { button, row, section, toast, toastError, failBlock } from '../ui/kit/index.js';

/*
 * «Заявки на новые позиции» — кладовщик подал с телефона («Принять» → «Подать заявку на новую позицию»), менеджер здесь решает.
 * «Создать позицию» открывает обычную форму новой позиции склада с названием из заявки (параметры fromReq и name в адресе);
 * после сохранения позиции заявка закрывается (closeRequest вызывает форма). «Отклонить» — закрывает без позиции.
 */
const paramsOf = () => new URLSearchParams(location.hash.split('?')[1] || '');
export const requestFromHash = () => ({ id: paramsOf().get('fromReq') || '', name: paramsOf().get('name') || '' });
export const closeRequest = (id, status, materialId) => api(`/material-requests/${id}/close`, { method: 'POST', body: { status, ...(materialId ? { materialId } : {}) } });

/** Плашка над списком склада; пока заявок нет или нет права — не видна. */
export function stockRequestsBox() {
  const box = h('div');
  box.hidden = true;
  if (!session.canEditOrders) return box;
  const load = () => api('/material-requests').then((r) => {
    const items = r.items || [];
    box.hidden = !items.length;
    box.replaceChildren(section({ title: 'Заявки на новые позиции', count: items.length, open: true, body: items.map((x) => row({
      title: x.text,
      meta: [x.createdByName, date(x.createdAt), x.qty ? `нужно ${fmt(x.qty)}` : ''].filter(Boolean).join(' · '),
      action: [
        button({ label: 'Создать позицию', kind: 'primary', size: 'S', onClick: () => go('stock', { new: '1', fromReq: x.id, name: x.text, open: undefined }) }),
        button({ label: 'Отклонить', kind: 'ghost', size: 'S', onClick: async () => {
          try { await closeRequest(x.id, 'rejected'); toast('Заявка отклонена'); load(); } catch (e) { toastError(e); }
        } })],
    })) }));
  }).catch((e) => {
    if (e?.status === 403) { box.hidden = true; return; } // нет права — блок не показываем
    box.hidden = false;
    box.replaceChildren(failBlock(e, load, { text: 'Заявки на новые позиции не загрузились' }));
  });
  load();
  return box;
}
