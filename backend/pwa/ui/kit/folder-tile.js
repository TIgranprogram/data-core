import { h } from '../../core/dom.js';
import { mark } from './mark.js';
import { button } from './index.js';

/**
 * folderTile — «папка» с файлами (C121): светло-жёлтая плитка с названием и числом файлов; клик раскрывает список.
 *   folderTile({ name, files: [{ id, name, meta, mime, ticket(): Promise<absoluteUrl>, onDownload() }], hint, open, onDrop(files[]) })
 *   → узел; .setFiles(list) обновляет содержимое без перерисовки папки.
 * Перетаскивание ИЗ папки (Chrome/Edge): на pointerenter берётся одноразовый тикет, строка становится draggable и отдаёт DownloadURL;
 * в других браузерах и на телефоне — кнопка «Скачать». onDrop — папка принимает файлы (подсветка .k-over); без onDrop зоны загрузки нет.
 */
const TICKET_MS = 50000; // тикет живёт 60 с и одноразовый — берём заново после перетаскивания и по истечении

function fileRow(f) {
  const row = h('li', { class: 'k-folder-file' }, h('span', { class: 'k-folder-name clip', title: f.name }, f.name), f.meta ? h('span', { class: 'muted small' }, f.meta) : null);
  row.append(button({ label: 'Скачать', size: 'S', kind: 'ghost', onClick: () => f.onDownload?.() }));
  if (!f.ticket) return row;
  let url = '', timer = 0, loading = false;
  const reset = () => { url = ''; clearTimeout(timer); row.draggable = false; row.classList.remove('is-drag-ready'); };
  const prefetch = async () => {
    if (url || loading) return;
    loading = true;
    try { url = await f.ticket(); row.draggable = !!url; row.classList.toggle('is-drag-ready', !!url); timer = setTimeout(reset, TICKET_MS); } catch { reset(); } finally { loading = false; }
  };
  row.addEventListener('pointerenter', prefetch);
  row.addEventListener('focusin', prefetch);
  row.addEventListener('dragstart', (e) => {
    if (!url) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `${f.mime || 'application/octet-stream'}:${String(f.name).replace(/:/g, '-')}:${url}`);
  });
  row.addEventListener('dragend', reset);
  return row;
}

export function folderTile({ name, files = [], hint, open = false, onDrop, extra } = {}) {
  const count = h('span', { class: 'badge dim k-folder-n' }, '0');
  const list = h('ul', { class: 'k-folder-list' });
  const body = h('div', { class: 'k-folder-body' }, list, extra || null); // extra — внутри открытой папки (кнопка «Загрузить файл»)
  const head = h('button', { type: 'button', class: 'k-folder-head', 'aria-expanded': 'false', onclick: () => toggle() },
    h('span', { class: 'k-folder-ico', 'aria-hidden': 'true' }, '📁'), h('span', { class: 'k-folder-title clip' }, name), count);
  const el = mark(h('div', { class: 'k-folder' }, head, body), 'folderTile');
  function toggle(v) {
    const on = v === undefined ? body.hidden : v;
    body.hidden = !on; head.setAttribute('aria-expanded', String(on)); el.classList.toggle('is-open', on);
  }
  el.setFiles = (fs) => {
    count.textContent = String(fs.length);
    list.replaceChildren(...(fs.length ? fs.map(fileRow) : [h('li', { class: 'muted small' }, hint || 'Пока пусто')]));
  };
  if (onDrop) {
    el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('k-over'); } });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('k-over'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('k-over'); const l = [...(e.dataTransfer?.files || [])]; if (l.length) { toggle(true); onDrop(l); } });
  }
  el.toggle = toggle;
  el.setFiles(files); toggle(open);
  return el;
}
