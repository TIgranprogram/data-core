import { h } from '../../core/dom.js';
import { mark } from './mark.js';
import { modal } from './dialog.js';
import { button } from './index.js';
import { toastError } from './toast.js';

/**
 * Окно просмотра PDF (КП-2): только просмотр, ввод остаётся в правой панели.
 * load() → { blob, name } (apiBlob). Кнопки: Обновить, Печать, Скачать PDF; «Вернуться к правке» закрывает окно.
 */
export function openPdfPreview({ title = 'Предпросмотр', load }) {
  let url = '';
  let name = 'document.pdf';
  const frame = h('iframe', { class: 'k-pdf', title });
  const status = h('p', { class: 'muted small' }, '');
  const show = async () => {
    status.textContent = 'Готовим PDF…';
    try {
      const r = await load();
      if (url) URL.revokeObjectURL(url);
      name = r.name || name;
      url = URL.createObjectURL(new Blob([r.blob], { type: 'application/pdf' }));
      frame.src = url;
      status.textContent = '';
    } catch (e) { status.textContent = ''; toastError(e, 'показать PDF'); }
  };
  const print = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); } };
  const save = () => { if (!url) return; const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); };
  const body = mark(h('div', { class: 'k-pdf-box' },
    h('div', { class: 'k-actions' },
      button({ label: 'Обновить', size: 'S', onClick: show }),
      button({ label: 'Печать', size: 'S', onClick: print }),
      button({ label: 'Скачать PDF', size: 'S', onClick: save })),
    status, frame,
    h('p', { class: 'muted small' }, 'Не видно PDF (часто на телефоне) — нажмите «Скачать PDF».')), 'pdf-preview');
  const done = modal({ title, body, wide: true, okText: 'Вернуться к правке' });
  document.querySelector('.modal-back:last-of-type .modal-foot .btn:not(.btn-primary)')?.remove(); // одна кнопка закрытия
  show();
  done.then(() => { if (url) URL.revokeObjectURL(url); });
  return done;
}
