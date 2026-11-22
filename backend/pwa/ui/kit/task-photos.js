import { PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { openZoom } from './gallery.js';
import { confirmDlg, hint, photoDrop, photoStrip, stack, toast, toastError } from './index.js';
import { openPopMenu } from './pop-menu.js';

const TASK_PHOTO_LIMIT = 20;

/** Первое своё фото — главное. До загрузки своего можно посмотреть фото изделия. */
export function taskPhotos({ initial, canEdit, add, remove, main, replace, changed }) {
  let model = initial;
  let replacing = null;
  const strip = h('div', { class: 'pf-strip' });
  const placeholder = hint('');
  const fallback = stack();
  const zone = canEdit ? photoDrop({ pickText: 'Загрузить фото задачи', attach: async (id) => {
    const old = replacing;
    replacing = null;
    model = old ? await replace(id, old) : await add(id);
    if (old) toast('Фото заменено', { undo: () => save(() => replace(old, id)) });
    return model;
  }, done: () => update() }) : null;

  function update(notify = true) {
    paint();
    if (notify) changed?.(model);
  }

  async function save(run) {
    try { model = await run(); update(); } catch (e) { toastError(e, 'сохранить фото'); }
  }

  function openMenu(anchor, p, i) {
    openPopMenu({ anchor, side: 'down', groups: [{ items: [
      ...(i > 0 ? [{ label: 'Сделать главным', onSelect: () => save(() => main(p.id)) }] : []),
      ...(replace ? [{ label: 'Заменить…', onSelect: () => {
        replacing = p.id;
        const input = zone.querySelector('input[type="file"]');
        input.multiple = false;
        input.click();
      } }] : []),
      { label: 'Убрать', danger: true, onSelect: async () => {
        if (await confirmDlg('Убрать фото?', 'Фото пропадёт из задачи.', { okText: 'Убрать' })) await save(() => remove(p.id));
      } },
    ] }] });
  }

  function paint() {
    const pics = (model.photos || []).filter((p) => p?.url);
    strip.replaceChildren(...pics.map((p, i) => h('div', { class: 'pf-item' },
      h('button', { type: 'button', class: 'k-photostrip-item', 'aria-label': i ? `Открыть фото ${i + 1}` : 'Открыть главное фото', onclick: () => openZoom(pics, i) },
        h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async' })),
      i === 0 ? h('span', { class: 'pf-tag' }, 'главное') : null,
      canEdit && p.id ? h('button', { type: 'button', class: 'pf-del', title: 'Действия с фото', 'aria-label': `Действия с фото ${i + 1}`, 'aria-haspopup': 'menu', onclick: (e) => openMenu(e.currentTarget, p, i) }, '⋯') : null)));
    strip.hidden = !pics.length;
    const product = !pics.length && model.productPhoto;
    fallback.replaceChildren(product ? hint('Фото изделия') : null, product ? photoStrip([product]) : null);
    const full = pics.length >= TASK_PHOTO_LIMIT;
    placeholder.textContent = full ? `Загружено ${TASK_PHOTO_LIMIT} фото. Уберите ненужное, чтобы добавить новое.` : !pics.length && !product ? 'Фото задачи пока нет.' : '';
    placeholder.hidden = !placeholder.textContent;
    if (zone) zone.hidden = full;
  }

  if (zone && replace) {
    const input = zone.querySelector('input[type="file"]');
    const reset = () => { replacing = null; input.multiple = true; };
    input.addEventListener('change', () => { input.multiple = true; });
    input.addEventListener('cancel', reset);
    zone.querySelector('button').addEventListener('click', reset, true);
  }
  update(false);
  return stack(strip, fallback, placeholder, zone);
}
