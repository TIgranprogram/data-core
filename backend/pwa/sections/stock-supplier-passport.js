import { api, session, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, fileButton, section, actions, toast, toastError, busyBlock, failBlock } from '../ui/kit/index.js';
import { sendFileTo } from './product-attachments.js';

/**
 * C136: блок «Паспорт поставщика» в карточке покупного материала (materialKind='purchased'): свой паспорт не делаем —
 * загрузить файл поставщика, скачать, заменить (старый уходит в корзину сам). Сервер: /materials/:id/attachments.
 * Для остальных материалов блока нет.
 */
const sizeText = (n) => (!n ? '0 КБ' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const dateText = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleDateString('ru-RU') : ''; };
const canUpload = () => session.canEditOrders; // как на сервере: admin, manager

export const isPurchased = (m) => m?.materialKind === 'purchased';

async function download(materialId, a) {
  const t = await api(`/materials/${materialId}/attachments/${a.id}/download-ticket`, { method: 'POST' });
  const link = document.createElement('a');
  link.href = PREFIX + (t.url || '');
  link.download = a.originalName || '';
  document.body.append(link); link.click(); link.remove();
}

export function supplierPassportBlock(r) {
  const box = h('div');
  const inner = h('div');
  let current = null; // действующий файл
  let sending = null; // { pct, error, abort }

  const upload = (file) => {
    sending = { pct: 0, error: '', abort: () => {} };
    paint();
    const s = sendFileTo(`/api/materials/${r.id}/attachments`, file, (a, b) => { const p = Math.min(100, Math.round(a * 100 / b)); if (p !== sending?.pct) { sending.pct = p; paint(); } });
    sending.abort = s.abort;
    s.promise.then(async () => {
      sending = null; toast(`Паспорт поставщика «${file.name}» загружен`);
      await load(true);
    }).catch((e) => { sending = e.aborted ? null : { pct: 0, error: e.message, file }; paint(); });
  };

  const filePick = (label) => (canUpload() ? fileButton({ label, onFile: (f) => f && upload(f) }) : null);

  function paint() {
    const rows = [];
    if (sending && !sending.error) {
      rows.push(h('p', { class: 'muted small' }, sending.pct >= 100 ? 'Сохраняю…' : `Загружено ${sending.pct} %`),
        actions(button({ label: 'Отмена', size: 'S', kind: 'ghost', onClick: () => sending?.abort() })));
    } else {
      if (sending?.error) rows.push(h('p', { class: 'hint' }, sending.error), actions(button({ label: 'Повторить', size: 'S', onClick: () => upload(sending.file) }), button({ label: 'Убрать', size: 'S', kind: 'ghost', onClick: () => { sending = null; paint(); } })));
      if (current) {
        rows.push(h('p', null, h('b', { class: 'clip', title: current.originalName }, current.originalName), h('span', { class: 'muted' }, ` · ${sizeText(current.size)} · ${dateText(current.uploadedAt)}${current.uploadedByName ? ' · ' + current.uploadedByName : ''}`)),
          actions(
            button({ label: 'Скачать', size: 'S', kind: 'ghost', onClick: async (e) => { const b = e.currentTarget; b.classList.add('is-busy'); try { await download(r.id, current); } catch (er) { toastError(er); } finally { b.classList.remove('is-busy'); } } }),
            filePick('Заменить')));
      } else if (!sending?.error) {
        rows.push(h('p', { class: 'muted small' }, canUpload() ? 'Паспорта поставщика нет — загрузите файл (PDF или скан). Он попадёт в архив паспортов заказа.' : 'Паспорта поставщика нет'), actions(filePick('Загрузить паспорт поставщика')));
      }
    }
    inner.replaceChildren(...rows);
    const n = box.querySelector(':scope > details > summary .k-sec-n'); if (n) n.textContent = current ? '1' : '0';
  }

  async function load(keepOpen) {
    if (!keepOpen) inner.replaceChildren(busyBlock('паспорт поставщика', { retry: () => load(false) }));
    try { current = ((await api(`/materials/${r.id}/attachments`)).items || [])[0] || null; } catch (e) { inner.replaceChildren(failBlock(e, () => load(false), { text: 'Паспорт поставщика не загрузился' })); return; }
    paint();
  }

  // только покупным: вид материала читаем один раз, остальные блока не получают
  api(`/materials/${r.id}`).then((m) => {
    if (!isPurchased(m)) return;
    box.replaceChildren(section({ title: 'Паспорт поставщика', tone: 'who', count: '…', open: true, body: inner }));
    load(false);
  }).catch(() => { /* карточка без блока: вид материала не узнали */ });
  return box;
}
