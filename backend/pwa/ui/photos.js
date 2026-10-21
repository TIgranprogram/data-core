import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { toastError } from './toast.js';

/**
 * Добавление фото в карточке (TASKS З.10): перетащить файлы, вставить из буфера (Ctrl+V — скриншот,
 * картинка из браузера) или выбрать файлом. Каждое фото: POST /photos/upload → attach(photoId, photo) → строка.
 *   photoDrop({ attach: async (photoId, { url, thumb }) => row, done(row) })
 * Вставка работает, пока зона на экране и курсор не в текстовом поле.
 */
export function photoDrop({ attach, done }) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const label = h('span', null, 'Перетащите фото сюда, вставьте Ctrl+V или ');
  const pick = h('button', { type: 'button', class: 'link-btn', onclick: () => input.click() }, 'выберите файл');
  const zone = h('div', { class: 'photo-drop', tabindex: '0', title: 'Можно вставить скриншот: Ctrl+V' }, h('span', { class: 'pd-ico', 'aria-hidden': 'true' }, '🖼'), h('span', null, label, pick), input);
  let busy = false;

  async function upload(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) { toastError(new Error('Это не картинка — нужны JPG, PNG, WEBP')); return; }
    if (busy) return;
    busy = true; zone.classList.add('busy');
    let row = null;
    try {
      for (const [i, f] of imgs.entries()) {
        label.textContent = `Загружаю ${i + 1} из ${imgs.length}… `;
        const fd = new FormData();
        fd.append('file', f, f.name && f.name !== 'image.png' ? f.name : `фото-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`);
        const ph = await api('/photos/upload', { method: 'POST', body: fd });
        row = await attach(String(ph._id || ph.id), { url: ph.storageUrl, thumb: ph.variants?.thumb?.storageUrl || ph.storageUrl });
      }
    } catch (e) { toastError(e); }
    finally {
      busy = false; zone.classList.remove('busy');
      label.textContent = 'Перетащите фото сюда, вставьте Ctrl+V или ';
      if (row) done(row);
    }
  }

  input.addEventListener('change', () => { if (input.files.length) upload(input.files); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files); });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  const onPaste = (e) => {
    if (!document.contains(zone)) { document.removeEventListener('paste', onPaste); return; }
    if (!zone.offsetParent) return; // зона скрыта (свёрнутый блок, «ещё» в строке счёта)
    const host = zone.closest('.inv-row, .field, .drawer') || zone.parentElement;
    const a = document.activeElement;
    // в счёте у каждой строки своя зона: вставляем только туда, где сейчас курсор
    if (zone.closest('.inv-row') && !(a && host.contains(a))) return;
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // обычный текст — пусть вставляется как обычно
    e.preventDefault();
    upload(files);
  };
  document.addEventListener('paste', onPaste);
  return zone;
}

/**
 * Фото внутри формы (новая запись / правка): миниатюры с «×» + зона добавления.
 * Файлы загружаются сразу, к записи привязываются при сохранении формы.
 *   const p = photoField([{ id, url, thumb }]);  p.el, p.ids() → ['…'], p.focus()
 */
export function photoField(initial = []) {
  let pics = [...initial];
  const strip = h('div', { class: 'pf-strip' });
  const render = () => strip.replaceChildren(...pics.map((p, i) => h('div', { class: 'pf-item' },
    h('img', { src: PREFIX + (p.thumb || p.url), alt: '', title: 'Открыть фото', onclick: () => window.open(PREFIX + p.url, '_blank') }),
    h('button', { type: 'button', class: 'pf-del', title: 'Убрать фото', 'aria-label': 'Убрать фото', onclick: () => { pics.splice(i, 1); render(); } }, '×'))));
  const drop = photoDrop({ attach: async (id, p) => { pics.push({ id, ...p }); return pics; }, done: render });
  render();
  return { el: h('div', { class: 'photo-field' }, strip, drop), ids: () => pics.map((p) => p.id), focus: () => drop.focus() };
}
