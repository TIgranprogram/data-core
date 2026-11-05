import { api, session, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, card, table, empty, actions, toast, toastError, confirmDlg, busyBlock, failBlock } from '../ui/kit/index.js';

/**
 * Блок «Вложения» в карточке изделия (ВЛ-1, FE-1): на каждый вид из справочника «Виды вложений» — карточка kit.card
 * (variant table) со списком файлов и кнопкой «Загрузить файлы». Загрузка — XHR с прогрессом и «Отмена»,
 * скачивание — по одноразовому тикету, удаление — только admin. Сервер: modules/productattachments.
 */
const sizeText = (n) => (!n ? '0 КБ' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const dateText = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleDateString('ru-RU') : ''; };
const canUpload = () => session.canEditOrders; // как на сервере: admin, manager

/** Понятный отказ сервера: формат / размер / место; текст сервера по-русски — как есть. */
export function uploadFailText(status, body) {
  let msg = '';
  try { const j = JSON.parse(body || '{}'); msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || ''; } catch { /* не JSON */ }
  const ru = /[а-яё]/i.test(msg);
  if (status === 0) return 'Нет связи с сервером. Проверьте интернет и повторите.';
  if (status === 413) return 'Файл слишком большой. Максимум — 512 МБ.';
  if (status === 507) return 'На сервере не хватает места для файлов. Сообщите администратору.';
  if (status === 401) return 'Сессия закончилась — войдите снова.';
  if (status === 403) return 'Загружать файлы может администратор или менеджер.';
  if (ru && [400, 404, 409, 415, 422].includes(status)) return msg;
  return 'Файл не загрузился. Проверьте формат и размер и повторите.';
}

/** Один файл: POST multipart с прогрессом. handle.abort() — отмена. Возвращает { promise, abort }. */
function sendFile(productId, typeId, file, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const fail = (status, body, extra) => reject(Object.assign(new Error(uploadFailText(status, body)), { status, ...extra }));
    const go = (retry) => {
      xhr.open('POST', `${PREFIX}/api/products/${productId}/attachments?typeId=${encodeURIComponent(typeId)}`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + session.access);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      xhr.onerror = () => fail(0, '');
      xhr.onabort = () => fail(0, '', { aborted: true });
      xhr.onload = async () => {
        if (xhr.status === 401 && retry) { // access мог истечь: фоновый запрос его обновит, и один повтор
          await api('/auth/me', { quiet: true }).catch(() => {});
          go(false); return;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(); else fail(xhr.status, xhr.responseText);
      };
      const fd = new FormData(); fd.append('file', file, file.name);
      xhr.send(fd);
    };
    go(true);
  });
  return { promise, abort: () => xhr.abort() };
}

async function download(productId, a) {
  const t = await api(`/products/${productId}/attachments/${a.id}/download-ticket`, { method: 'POST' });
  const link = document.createElement('a');
  link.href = PREFIX + (t.url || `/api/products/${productId}/attachments/${a.id}/file?t=${t.ticket}`);
  link.download = a.originalName || '';
  document.body.append(link); link.click(); link.remove();
}

export function productAttachmentsBlock(r) {
  const title = h('div', { class: 'section-title' }, 'Вложения');
  const root = h('div', null, title, busyBlock('вложения изделия', { retry: load }));
  const up = new Map(); // typeId -> [{ name, pct, abort }] — загрузки в процессе
  const bodies = new Map(); // typeId -> контейнер таблицы
  let types = [], files = [];

  const rowsOf = (typeId) => {
    const done = files.filter((f) => f.typeId === typeId).map((f) => ({ cells: [
      h('span', { class: 'clip', title: f.originalName }, f.originalName), { v: sizeText(f.size), cls: 'num right' }, dateText(f.uploadedAt), f.uploadedByName || '',
      actions(
        button({ label: 'Скачать', size: 'S', kind: 'ghost', onClick: async (e) => { const b = e.currentTarget; b.classList.add('is-busy'); try { await download(r.id, f); } catch (er) { toastError(er); } finally { b.classList.remove('is-busy'); } } }),
        session.isAdmin ? button({ label: 'Убрать', size: 'S', kind: 'ghost', onClick: () => remove(f) }) : null)] }));
    const going = (up.get(typeId) || []).map((u) => (u.error
      ? { cells: [h('span', { class: 'clip', title: u.name }, u.name), { v: u.size, cls: 'num right' }, u.error, '',
        actions(button({ label: 'Повторить', size: 'S', onClick: () => run(typeId, u) }), button({ label: 'Убрать', size: 'S', kind: 'ghost', onClick: () => dismiss(typeId, u) }))] }
      : { cells: [
        h('span', { class: 'clip', title: u.name }, u.name), { v: u.size, cls: 'num right' }, u.pct >= 100 ? 'Сохраняю…' : `Загружено ${u.pct} %`, '',
        button({ label: 'Отмена', size: 'S', kind: 'ghost', onClick: () => u.abort() })] }));
    return [...going, ...done];
  };

  const paintType = (typeId) => {
    const box = bodies.get(typeId);
    if (!box) return;
    const rows = rowsOf(typeId);
    box.replaceChildren(table({
      label: 'Файлы вида', rows,
      columns: [{ label: 'Файл' }, { label: 'Размер', num: true }, { label: 'Загружен', hide: true }, { label: 'Кто', hide: true }, { label: '' }],
      empty: { title: 'Файлов нет', hint: canUpload() ? 'Перетащите файлы сюда или нажмите «Загрузить файлы» — можно несколько сразу.' : '' },
    }));
  };

  async function remove(f) {
    if (!(await confirmDlg('Убрать файл?', f.originalName, { okText: 'Убрать' }))) return;
    try { await api(`/products/${r.id}/attachments/${f.id}`, { method: 'DELETE' }); files = files.filter((x) => x.id !== f.id); paintType(f.typeId); toast('Файл убран'); } catch (e) { toastError(e); }
  }

  const dismiss = (typeId, u) => { const q = up.get(typeId) || []; q.splice(q.indexOf(u), 1); paintType(typeId); };

  /** Один файл: загрузка; при отказе строка остаётся с причиной и «Повторить». */
  async function run(typeId, u) {
    u.error = ''; u.pct = 0; paintType(typeId);
    const s = sendFile(r.id, typeId, u.file, (a, b) => { const p = Math.min(100, Math.round(a * 100 / b)); if (p !== u.pct) { u.pct = p; paintType(typeId); } });
    u.abort = s.abort;
    try {
      await s.promise;
      toast(`Файл «${u.name}» загружен`);
      dismiss(typeId, u);
    } catch (e) {
      if (e.aborted) dismiss(typeId, u); else { u.error = e.message; paintType(typeId); return; }
    }
    try { files = (await api(`/products/${r.id}/attachments`)).items || []; } catch { /* список обновится при следующем открытии */ }
    paintType(typeId);
  }

  async function sendAll(typeId, list) {
    const q = up.get(typeId) || []; up.set(typeId, q);
    const items = list.map((file) => ({ file, name: file.name, size: sizeText(file.size), pct: 0, error: '', abort: () => {} }));
    q.push(...items); paintType(typeId);
    for (const u of items) if (q.includes(u)) await run(typeId, u);
  }

  /** Перетащить файлы на карточку вида или вставить Ctrl+V (как photoDrop); вставка — туда, где курсор или фокус. */
  function wireDrop(node, send) {
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('k-over'); });
    node.addEventListener('dragleave', () => node.classList.remove('k-over'));
    node.addEventListener('drop', (e) => { e.preventDefault(); node.classList.remove('k-over'); const l = [...(e.dataTransfer?.files || [])]; if (l.length) send(l); });
    const onPaste = (e) => {
      if (!document.contains(node)) { document.removeEventListener('paste', onPaste); return; }
      if (!node.offsetParent || !(node.matches(':hover') || node.contains(document.activeElement))) return;
      const l = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      if (!l.length) return;
      e.preventDefault(); send(l);
    };
    document.addEventListener('paste', onPaste);
  }

  const typeCard = (t) => {
    const box = h('div');
    bodies.set(t.id, box);
    const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { const l = [...input.files]; input.value = ''; if (l.length) sendAll(t.id, l); } });
    const node = card({ size: 'M', title: t.name, meta: t.formats ? 'Форматы: ' + t.formats : null, variant: 'table', body: box,
      actions: canUpload() ? [input, button({ label: 'Загрузить файлы', size: 'S', onClick: () => input.click() })] : null });
    if (canUpload()) wireDrop(node, (l) => sendAll(t.id, l));
    paintType(t.id);
    return node;
  };

  async function load() {
    root.replaceChildren(title, busyBlock('вложения изделия', { retry: load }));
    try {
      const [tr, fr] = await Promise.all([api('/dicts/attachmentTypes'), api(`/products/${r.id}/attachments`)]);
      types = (tr.items || tr).filter((t) => t && t.name).map((t) => ({ id: String(t.id || t._id), name: t.name, formats: t.formats || '', order: Number(t.order) || 0 }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
      files = fr.items || [];
    } catch (e) {
      root.replaceChildren(title, failBlock(e, load, { text: 'Вложения изделия не загрузились' }));
      return;
    }
    bodies.clear();
    root.replaceChildren(title, types.length
      ? h('div', null, ...types.map(typeCard))
      : empty({ title: 'Виды вложений не заведены', hint: 'Администратор добавляет их в справочнике «Виды вложений».' }));
  }
  load();
  return root;
}
