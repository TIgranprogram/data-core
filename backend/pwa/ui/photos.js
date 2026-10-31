import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { toastError } from './toast.js';

/** Загрузить одну картинку: POST /photos/upload -> { id, url, thumb }. Общая для drop-зоны и чата. */
export async function uploadPhoto(f) {
  const fd = new FormData();
  fd.append('file', f, f.name && f.name !== 'image.png' ? f.name : `фото-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`);
  const ph = await api('/photos/upload', { method: 'POST', body: fd });
  return { id: String(ph._id || ph.id), url: ph.storageUrl, thumb: ph.variants?.thumb?.storageUrl || ph.storageUrl };
}

/**
 * Добавление фото в карточке (TASKS З.10): перетащить файлы, вставить из буфера (Ctrl+V — скриншот,
 * картинка из браузера) или выбрать файлом. Каждое фото: POST /photos/upload → attach(photoId, photo) → строка.
 *   photoDrop({ attach: async (photoId, { url, thumb }) => row, done(row) })
 * Вставка работает, пока зона на экране и курсор не в текстовом поле.
 */
export function photoDrop({ attach, done, pdf = false }) {
  // pdf: true — ещё и PDF (файл счёта, скан договора); фото заявок/изделий — только картинки
  const input = h('input', { type: 'file', accept: pdf ? 'image/*,application/pdf' : 'image/*', multiple: true, hidden: true });
  const idle = pdf ? 'Перетащите файл (PDF или фото) сюда или вставьте Ctrl+V' : 'Перетащите фото сюда или вставьте Ctrl+V';
  const label = h('span', { class: 'pd-text' }, idle);
  const pick = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => input.click() }, 'Выбрать файл');
  const zone = h('div', { class: 'photo-drop', tabindex: '0', title: 'Можно вставить скриншот: Ctrl+V' }, h('span', { class: 'pd-ico', 'aria-hidden': 'true' }, '🖼'), label, pick, input);
  let busy = false;

  async function upload(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type) || (pdf && f.type === 'application/pdf'));
    if (!imgs.length) { toastError(new Error(pdf ? 'Нужен PDF или картинка (JPG, PNG, WEBP)' : 'Это не картинка — нужны JPG, PNG, WEBP')); return; }
    if (busy) return;
    busy = true; zone.classList.add('busy');
    let row = null;
    try {
      for (const [i, f] of imgs.entries()) {
        label.textContent = `Загружаю ${i + 1} из ${imgs.length}… `;
        const { id, ...pic } = await uploadPhoto(f);
        row = await attach(id, pic);
      }
    } catch (e) { toastError(e); }
    finally {
      busy = false; zone.classList.remove('busy');
      label.textContent = idle;
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
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // обычный текст — пусть вставляется как обычно
    // зон на экране несколько (строки счёта, виды картинок паспорта — в карточке и в форме): вставляем только туда,
    // где курсор (фокус или мышь); раньше в форме паспорта одна вставка уходила во все виды сразу
    const visible = [...document.querySelectorAll('.photo-drop')].filter((z) => z.offsetParent);
    if (visible.length > 1) {
      const a = document.activeElement;
      const hostOf = (z) => z.closest('.inv-row, .pp-kind, .field') || z.parentElement;
      const aimed = (z) => { const hs = hostOf(z); return (a && hs.contains(a)) || hs.matches(':hover'); };
      if (!aimed(zone)) {
        if (zone === visible[0] && !visible.some(aimed)) toastError(new Error('Куда вставить? Наведите курсор на нужный вид картинки (или щёлкните по нему) и нажмите Ctrl+V ещё раз'));
        return;
      }
    }
    e.preventDefault();
    upload(files);
  };
  document.addEventListener('paste', onPaste);
  return zone;
}

/**
 * Фото внутри формы (новая запись / правка): миниатюры с «×» + зона добавления.
 * Файлы загружаются сразу, к записи привязываются при сохранении формы.
 *   const p = photoField([{ id, url, thumb }]);  p.el, p.ids() → ['…'], p.set([{ id, url, thumb }]) — заменить (картинки модели), p.focus()
 *   main: true — на первом фото подпись «главное» (фото изделия)
 */
export const isPdf = (p) => p?.mime === 'application/pdf' || /\.pdf$/i.test(String(p?.url || ''));

export function photoField(initial = [], { pdf = false, main = false } = {}) {
  let pics = [...initial];
  const strip = h('div', { class: 'pf-strip' });
  const render = () => strip.replaceChildren(...pics.map((p, i) => h('div', { class: 'pf-item' },
    isPdf(p)
      ? h('a', { class: 'pf-pdf', href: PREFIX + p.url, target: '_blank', rel: 'noopener', title: 'Открыть PDF' }, h('span', { 'aria-hidden': 'true' }, '📄'), h('span', { class: 'pf-pdf-name' }, p.name || 'PDF'))
      : h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async', title: 'Открыть фото', onclick: () => window.open(PREFIX + p.url, '_blank') }),
    main && !i ? h('span', { class: 'pf-tag' }, 'главное') : null,
    h('button', { type: 'button', class: 'pf-del', title: 'Убрать фото', 'aria-label': 'Убрать фото', onclick: () => { pics.splice(i, 1); render(); } }, '×'),
    // первое — главное; ★ у другого — поставить его первым
    pics.length > 1 ? h('button', { type: 'button', class: 'pf-main' + (i ? '' : ' on'), title: i ? 'Сделать главным' : 'Главное фото', 'aria-label': i ? 'Сделать главным' : 'Главное фото', onclick: () => { if (i) { pics.unshift(...pics.splice(i, 1)); render(); } } }, i ? '☆' : '★') : null)));
  const drop = photoDrop({ attach: async (id, p) => { pics.push({ id, ...p }); return pics; }, done: render, pdf });
  render();
  return { el: h('div', { class: 'photo-field' }, strip, drop), ids: () => pics.map((p) => p.id), set: (list) => { pics = [...(list || [])]; render(); }, focus: () => drop.focus() };
}
