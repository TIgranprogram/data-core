/**
 * «Вложения» позиции заказа (C121): светло-жёлтые папки по видам из справочника «Виды вложений» (kit folderTile).
 * Файлы — GET /incomes/:id/attachments (изделие + сама позиция); сервера нет — папки изделия GET /products/:id/attachments.
 * Скачать — одноразовый тикет (как product-attachments), перетащить на рабочий стол — DownloadURL; загрузить — файл на папку (admin, manager).
 */
import { api, session, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { card, empty, failBlock, busyBlock, stack, fileButton, actions } from '../ui/kit/index.js';
import { canWorkPassport } from './passports/common.js';
import { useFileAsPassport } from './passport-source-picker.js';
import { busyBtn } from '../ui/kit/busy.js';
import { folderTile } from '../ui/kit/folder-tile.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { uploadFailText } from './product-attachments.js';

const sizeText = (n) => (!n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

async function ticketUrl(productId, f) {
  const t = await api(`/products/${productId}/attachments/${f.id}/download-ticket`, { method: 'POST' });
  return PREFIX + (t.url || `/api/products/${productId}/attachments/${f.id}/file?t=${t.ticket}`);
}

async function upload(incomeId, typeId, file) {
  const fd = new FormData(); fd.append('file', file, file.name);
  const r = await fetch(`${PREFIX}/api/incomes/${incomeId}/attachments?typeId=${encodeURIComponent(typeId)}`, { method: 'POST', headers: { Authorization: 'Bearer ' + session.access }, body: fd });
  if (!r.ok) throw new Error(uploadFailText(r.status, await r.text().catch(() => '')));
}

export function lineFilesCard(l) {
  const body = h('div', null, busyBlock('вложения позиции', { retry: load }));
  const root = card({ size: 'M', title: 'Вложения', variant: 'fields', body });
  const canUp = !!(l.productId && session.canEditOrders);
  const tiles = new Map();
  let files = [];

  const fill = () => {
    for (const [id, t] of tiles) {
      t.setFiles(files.filter((f) => f.typeId === id).map((f) => ({
        id: f.id, name: f.originalName || f.name, mime: f.mime, meta: [f.scope === 'line' ? 'позиция' : 'изделие', sizeText(f.size)].filter(Boolean).join(' · '),
        action: canWorkPassport() && l.orderId && !l.cancelledAt ? { label: 'Использовать как паспорт', onClick: async (e) => {
          const end = busyBtn(e.currentTarget, null);
          try { if (await useFileAsPassport(l.orderId, l.id, f)) toast('Вложенный паспорт выбран'); }
          catch (err) { toastError(err); } finally { end(); }
        } } : null,
        ticket: () => ticketUrl(l.productId, f), onDownload: async () => { try { const u = await ticketUrl(l.productId, f); const a = h('a', { href: u, download: f.originalName || f.name }); document.body.append(a); a.click(); a.remove(); } catch (e) { toastError(e); } },
      })));
    }
  };
  const fetchFiles = async () => {
    try { const r = await api(`/incomes/${l.id}/attachments`); return (r.items || []).map((f) => ({ ...f, scope: f.scope || 'product' })); } catch (e) {
      if (e.status && e.status !== 404) throw e;
      return ((await api(`/products/${l.productId}/attachments`)).items || []).map((f) => ({ ...f, name: f.originalName, scope: 'product' }));
    }
  };
  async function send(typeId, list) {
    for (const f of list) {
      try { await upload(l.id, typeId, f); toast(`Файл «${f.name}» загружен`); } catch (e) { toastError(e); }
    }
    try { files = await fetchFiles(); fill(); } catch { /* обновится при следующем открытии */ }
  }
  async function load() {
    body.replaceChildren(busyBlock('вложения позиции', { retry: load }));
    if (!l.productId) { body.replaceChildren(h('p', { class: 'muted small' }, 'У позиции нет изделия — файлов нет.')); return; }
    try {
      const [tr, fs] = await Promise.all([api('/dicts/attachmentTypes'), fetchFiles()]);
      files = fs;
      const types = (tr.items || tr).filter((t) => t && t.name).map((t) => ({ id: String(t.id || t._id), name: t.name, order: Number(t.order) || 0 }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
      tiles.clear();
      if (!types.length) { body.replaceChildren(empty({ title: 'Виды вложений не заведены', hint: 'Администратор добавляет их в справочнике «Виды вложений».' })); return; }
      body.replaceChildren(stack(...types.map((t) => {
        // «Загрузить файл» — внутри открытой папки, не под каждой (дизайнер C121): телефон и Firefox грузят им, Chrome — и перетаскиванием
        const up = canUp ? actions(fileButton({ label: 'Загрузить файл', multiple: true, onFiles: (fs2) => send(t.id, fs2) })) : null;
        const el = folderTile({ name: t.name, hint: canUp ? 'Пусто — перетащите файл сюда или нажмите «Загрузить файл»' : 'Файлов нет', onDrop: canUp ? (l2) => send(t.id, l2) : undefined, extra: up });
        tiles.set(t.id, el); return el;
      })));
      fill();
    } catch (e) { body.replaceChildren(failBlock(e, load, { text: 'Вложения не загрузились' })); }
  }
  load();
  return root;
}
