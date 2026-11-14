import { api, PREFIX } from '../../core/api.js';
import { mark } from './mark.js';
import { h } from '../../core/dom.js';
import { toastError } from './toast.js';

/** Загрузить одну картинку: POST /photos/upload -> { id, url, thumb }. Общая для drop-зоны и чата. */
export async function uploadPhoto(f, purpose) {
  const fd = new FormData();
  fd.append('file', f, f.name && f.name !== 'image.png' ? f.name : `фото-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`);
  const ph = await api('/photos/upload' + (purpose ? '?purpose=' + purpose : ''), { method: 'POST', body: fd });
  return { id: String(ph._id || ph.id), url: ph.storageUrl, thumb: ph.variants?.thumb?.storageUrl || ph.storageUrl, mime: ph.mimeType || ph.mime || f.type || '', name: ph.originalFilename || ph.name || f.name || '', size: ph.size || ph.sizeBytes || f.size || 0 };
}

/**
 * Добавление фото в карточке (TASKS З.10): перетащить файлы, вставить из буфера (Ctrl+V — скриншот,
 * картинка из браузера) или выбрать файлом. Каждое фото: POST /photos/upload → attach(photoId, photo) → строка.
 *   photoDrop({ attach: async (photoId, { url, thumb }) => row, done(row) })
 * Вставка работает, пока зона на экране и курсор не в текстовом поле.
 */
/**
 * Куда уйдёт вставка Ctrl+V (C086, UI-ACCEPTANCE п. 5): ровно одна зона. Зона одна — она. Иначе фокус сильнее мыши:
 * зона, в чьей строке стоит фокус (щёлкнули по зоне или её кнопке); фокуса в зонах нет — та, над которой курсор.
 * Ни фокуса, ни курсора — null: спросим, куда вставить. hostOf — строка/слот зоны (подпись и кнопки рядом — тоже «она»).
 */
export function pasteTarget(zones, { active, hovered, hostOf }) {
  if (zones.length <= 1) return zones[0] || null;
  const inHost = (z, el) => !!el && hostOf(z).contains(el);
  return zones.find((z) => inHost(z, active)) || zones.find((z) => hovered(hostOf(z))) || null;
}

export function photoDrop({ attach, done, pdf = false, purpose, drawing = false, idleText, searchText, pickText = 'Выбрать файл' }) {
  // searchText — название позиции: кнопка «Найти фото в интернете» откроет Яндекс.Картинки с ним (пользователь 2026-11-08);
  // картинку оттуда: правая кнопка → «Копировать изображение» → сюда Ctrl+V (вставка ниже уже умеет)
  // purpose — назначение файла на сервере (passport, drawing); drawing: true — чертежи (PDF, DWG, DXF и картинки)
  // pdf: true — ещё и PDF (файл счёта, скан договора); фото заявок/изделий — только картинки
  const input = h('input', { type: 'file', accept: drawing ? 'image/*,application/pdf,.pdf,.dwg,.dxf' : pdf ? 'image/*,application/pdf' : 'image/*', multiple: true, hidden: true });
  const idle = idleText || (drawing ? 'Перетащите чертёж (PDF, DWG, DXF) сюда или вставьте Ctrl+V' : null) || (pdf ? 'Перетащите файл (PDF или фото) сюда или вставьте Ctrl+V' : 'Перетащите фото сюда или вставьте Ctrl+V');
  const label = h('span', { class: 'pd-text' }, idle);
  // диалог выбора файла открывает только эта кнопка; щелчок по самой зоне даёт ей фокус для Ctrl+V (C086)
  const pick = h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); input.click(); } }, pickText);
  const q = String(searchText || '').trim();
  const find = q ? h('a', { class: 'btn btn-sm', href: 'https://yandex.ru/images/search?text=' + encodeURIComponent(q), target: '_blank', rel: 'noopener noreferrer',
    title: 'Откроется поиск картинок. Понравилась — правая кнопка → «Копировать изображение», вернитесь сюда и нажмите Ctrl+V' }, 'Найти фото в интернете') : null;
  const zone = mark(h('div', { class: 'photo-drop', tabindex: '0', role: 'group', 'aria-label': idle || 'Зона вставки файла', title: 'Щёлкните по зоне и нажмите Ctrl+V — вставится сюда. Файл с диска — кнопка «' + pickText + '».' }, h('span', { class: 'pd-ico', 'aria-hidden': 'true' }, '🖼'), label, pick, find, input), 'photoDrop');
  let busy = false;

  async function upload(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type) || ((pdf || drawing) && f.type === 'application/pdf') || (drawing && /\.(pdf|dwg|dxf)$/i.test(f.name)));
    if (!imgs.length) { toastError(new Error(drawing ? 'Нужен чертёж: PDF, DWG, DXF или картинка' : pdf ? 'Нужен PDF или картинка (JPG, PNG, WEBP)' : 'Это не картинка — нужны JPG, PNG, WEBP')); return; }
    if (busy) return;
    busy = true; zone.classList.add('busy');
    let row = null;
    try {
      for (const [i, f] of imgs.entries()) {
        label.textContent = `Загружаю ${i + 1} из ${imgs.length}… `;
        const { id, ...pic } = await uploadPhoto(f, purpose);
        row = await attach(id, pic);
      }
    } catch (e) { toastError(e); }
    finally {
      busy = false; zone.classList.remove('busy');
      label.textContent = idle;
      if (row) done?.(row);
    }
  }

  input.addEventListener('change', () => { if (input.files.length) upload(input.files); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files); });
  const onPaste = (e) => {
    if (!document.contains(zone)) { document.removeEventListener('paste', onPaste); return; }
    if (!zone.offsetParent) return; // зона скрыта (свёрнутый блок, «ещё» в строке счёта)
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // обычный текст — пусть вставляется как обычно
    // зон на экране несколько (строки счёта, виды картинок паспорта — в карточке и в форме): вставляем только туда,
    // где курсор (фокус или мышь); раньше в форме паспорта одна вставка уходила во все виды сразу
    // и где курсор: раньше «фокус ИЛИ мышь» — фокус в одном слоте и мышь над другим давали две загрузки. Теперь цель одна (pasteTarget)
    const visible = [...document.querySelectorAll('.photo-drop')].filter((z) => z.offsetParent);
    const hostOf = (z) => z.closest('.inv-row, .pp-kind, .pp-slot, .field') || z.parentElement;
    const target = pasteTarget(visible, { active: document.activeElement, hovered: (el) => el.matches(':hover'), hostOf });
    if (target !== zone) {
      if (!target && zone === visible[0]) toastError(new Error('Куда вставить? Щёлкните по нужной зоне (она подсветится) и нажмите Ctrl+V ещё раз'));
      return;
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
  return { el: mark(h('div', { class: 'photo-field' }, strip, drop), 'photoField'), ids: () => pics.map((p) => p.id), set: (list) => { pics = [...(list || [])]; render(); }, focus: () => drop.focus() };
}
