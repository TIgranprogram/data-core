import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, toast, toastError, confirmDlg, section, stack, row, link, photoDrop, busyBlock, failBlock } from '../ui/kit/index.js';
import { openZoom } from '../ui/kit/gallery.js';
import { kindName, kindNorm } from '../core/passport-kinds.js';

/**
 * Вкладка «Файлы»: «Чертежи (раньше загруженные)». Рисунки паспорта — в правке шаблона (C056), не здесь.
 * Загрузка рисунка — общий photoDrop (перетащить, Ctrl+V, выбрать файл).
 */

/** Привязать загруженный файл к изделию: рисунок паспорта (kind) или чертёж; old — прежняя запись вида: сначала добавляем новый, при успехе убираем старый. */
export async function attachProductFile(productId, photoId, purpose, kind, old) {
  await api(`/products/${productId}/photos`, { method: 'POST', body: { photoId, purpose, ...(kind ? { kind } : {}) } });
  if (!old) return;
  // новый уже сохранён — прежний убираем после успеха; не вышло: новый не теряем, оба видны, лишний пользователь уберёт сам
  try { await api(`/products/${productId}/photos/${old}`, { method: 'DELETE' }); }
  catch (e) { toast('Новый файл сохранён, но прежний убрать не удалось — уберите его вручную: ' + (e?.message || 'ошибка'), { ms: 9000 }); }
}

/** Маленькая карточка одного рисунка паспорта: просмотр, загрузка, замена, удаление. */
export function passportSlot({ productId, kind, label, rec, canEdit, required, onChange }) {
  const k = kindNorm(kind);
  const name = label || kindName(k);
  const ph = rec?.photoId;
  const thumb = ph?.variants?.thumb?.storageUrl || ph?.storageUrl || '';
  const full = ph?.storageUrl || thumb;
  const del = async (e) => {
    e?.stopPropagation?.();
    if (!(await confirmDlg('Убрать фото?', 'Файл останется в выпущенных паспортах.', { okText: 'Убрать' }))) return;
    try { await api(`/products/${productId}/photos/${rec.id}`, { method: 'DELETE' }); onChange?.(); } catch (er) { toastError(er); }
  };
  const cap = h('div', { class: 'pp-slot-cap', title: name }, name, required && !thumb ? h('span', { class: 'need' }, ' *') : null);
  if (thumb) {
    const src = (u) => (u.startsWith('http') || u.startsWith(PREFIX) ? u : PREFIX + u);
    const zoom = () => openZoom([{ url: src(full) }]);
    return h('div', { class: 'pp-slot' },
      h('div', { class: 'pp-slot-pic' },
        h('div', { class: 'pp-slot-zoom', role: 'button', tabindex: '0', title: 'Открыть крупно', 'aria-label': name,
          onclick: zoom, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(); } } },
          h('img', { src: src(thumb), alt: name, loading: 'lazy' })),
        canEdit ? button({ label: '×', kind: 'ghost', size: 'S', cls: 'pp-slot-x', title: 'Убрать фото', onClick: del }) : null),
      cap,
      canEdit ? h('div', { class: 'pp-slot-replace', title: 'Заменить фото' }, passportKindDrop(productId, k, onChange, rec.id, { compact: true })) : null);
  }
  return h('div', { class: 'pp-slot' + (required ? ' need' : '') },
    canEdit ? passportKindDrop(productId, k, onChange, null, { compact: true }) : h('div', { class: 'pp-slot-empty muted' }, 'нет'),
    cap);
}

/** Зона загрузки рисунка паспорта. compact — маленькая карточка в сетке (C055). */
export function passportKindDrop(productId, kind, done, old, { compact = false } = {}) {
  const drop = photoDrop({ purpose: 'passport',
    idleText: compact ? '＋ фото' : 'Перетащите рисунок сюда или вставьте Ctrl+V',
    attach: async (photoId) => { await attachProductFile(productId, photoId, 'passport', kind, old); return true; },
    done: () => { toast('Рисунок сохранён'); done?.(); } });
  if (compact) {
    drop.classList.add('pp-slot-drop');
    drop.querySelector('.btn')?.replaceWith(); // «Выбрать файл» — клик по карточке / Ctrl+V
    drop.title = 'Перетащите сюда, вставьте Ctrl+V или нажмите, чтобы выбрать файл';
    drop.addEventListener('click', (e) => { if (e.target.closest('input')) return; drop.querySelector('input[type=file]')?.click(); });
  }
  return drop;
}

const fileIcon = (name) => ({ pdf: '📄', dwg: '📐', dxf: '📐' })[String(name).split('.').pop().toLowerCase()] || '🖼';
const sizeText = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

export function productFilesBlock(r, canEdit) {
  // ПМ-1: без заголовка-линии — сама секция карточкой в колонке. Рисунки паспорта здесь больше не живут (C056).
  const root = stack(busyBlock('файлы изделия', { retry: paint }));
  const drawingRow = (rec) => {
    const f = rec.photoId || {};
    const name = f.originalFilename || f.name || 'Чертёж';
    const del = async () => {
      if (!(await confirmDlg('Убрать чертёж?', name, { okText: 'Убрать' }))) return;
      try { await api(`/products/${r.id}/photos/${rec.id}`, { method: 'DELETE' }); await paint(); } catch (e) { toastError(e); }
    };
    return row({ lead: h('span', { 'aria-hidden': 'true' }, fileIcon(name)), title: name, meta: sizeText(f.size || f.sizeBytes),
      action: [link({ label: 'Скачать', href: PREFIX + (f.storageUrl || ''), target: '_blank' }), canEdit ? button({ label: 'Убрать', size: 'S', kind: 'ghost', onClick: del }) : null] });
  };
  async function paint() {
    let drawings = [];
    try {
      drawings = await api(`/products/${r.id}/photos?purpose=drawing`).then((x) => x.items || x).catch(() => []);
    } catch (e) {
      root.replaceChildren(failBlock(e, paint, { text: 'Фото и файлы изделия не загрузились' }));
      return;
    }
    const dr = drawings || [];
    if (!dr.length) { root.replaceChildren(); return; }
    // Чертежи — одно место: «Вложения → Чертежи». Здесь только уже загруженные раньше, без новой загрузки.
    const drawingsBody = h('div', null, h('div', null, ...dr.map(drawingRow)), h('p', { class: 'muted small' }, 'Новые чертежи загружайте во «Вложения → Чертежи».'));
    const open = root.querySelector('details.k-sec')?.open;
    const s = section({ title: 'Чертежи (раньше загруженные)', count: dr.length, body: drawingsBody, open, tone: 'info' });
    root.replaceChildren(s);
  }
  paint();
  return root;
}
