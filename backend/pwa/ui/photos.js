import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { toastError } from './toast.js';

/**
 * Добавление фото в карточке (TASKS З.10): перетащить файлы, вставить из буфера (Ctrl+V — скриншот,
 * картинка из браузера) или выбрать файлом. Каждое фото: POST /photos/upload → attach(photoId) → строка.
 *   photoDrop({ attach: async (photoId) => row, done(row) })
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
        row = await attach(String(ph._id || ph.id));
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
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // обычный текст — пусть вставляется как обычно
    e.preventDefault();
    upload(files);
  };
  document.addEventListener('paste', onPaste);
  return zone;
}
