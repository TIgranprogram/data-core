import { api } from '../../core/api.js';
import { actions, button, confirmDlg, field, fieldRow, hint, photoDrop, section, select, stack, textInput } from '../../ui/kit/index.js';
import { attachProductFile, passportSlot } from '../product-files.js';

export const moduleTotal = (rows) => rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
export const modulesSummary = (rows) => {
  const count = rows.length;
  const word = count === 1 ? 'вид' : count >= 2 && count <= 4 ? 'вида' : 'видов';
  return `${count} ${word}, всего ${moduleTotal(rows)} шт.`;
};
const photoIdOf = (row) => String(row.photoId?.id || row.photoId?._id || row.photoId || '');

export function moduleRows(value) {
  const rows = typeof value === 'string' ? JSON.parse(value || '[]') : value;
  if (rows?.length > 20) throw new Error('Не больше 20 модулей');
  return (Array.isArray(rows) ? rows : []).map(({ name, dims, qty, photoId }, index) => {
    const title = String(name || '').trim();
    const size = String(dims || '').trim();
    if (!title || title.length > 120) throw new Error(`Модуль ${index + 1}: укажите название (до 120 символов)`);
    if (size.length > 60) throw new Error(`Модуль ${index + 1}: габариты — до 60 символов`);
    if (!Number.isInteger(Number(qty)) || qty < 1 || qty > 10000) throw new Error(`Модуль ${index + 1}: количество — целое от 1 до 10000`);
    return { name: title, qty: Number(qty), ...(size ? { dims: size } : {}), ...(photoId ? { photoId } : {}) };
  });
}

export function modulesEditor({ value, productId = () => '', canEdit = true, save, onDone }) {
  const el = stack();
  const error = hint('', 'warn');
  error.setAttribute('role', 'alert');
  let rows = [];
  let supplied = false;
  let photoProduct;
  let photos = [];
  let request = 0;
  let saved;
  let tail = Promise.resolve();
  let sequence = 0;

  function report(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function changed() {
    supplied = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (!save) return;
    const version = ++sequence;
    let next;
    try { next = moduleRows(rows); } catch (e) { report(e.message); return; }
    report();
    tail = tail.then(async () => {
      if (JSON.stringify(next) === saved) return;
      try {
        await save(next);
        saved = JSON.stringify(next);
      } catch (e) {
        if (version === sequence) report(e.message);
      }
    });
  }

  async function loadPhotos() {
    const id = productId();
    if (id === photoProduct) return;
    photoProduct = id;
    photos = [];
    const version = ++request;
    for (const update of photoUpdates) update();
    if (!id) return;
    try {
      const data = await api(`/products/${id}/photos?purpose=passport`);
      if (version !== request) return;
      photos = (data.items || data).filter((item) => item.kind === 'module');
      for (const update of photoUpdates) update();
    } catch (e) {
      if (version === request) report(e.message);
    }
  }

  let photoUpdates = [];
  function draw() {
    photoUpdates = [];
    const parts = rows.map((item, index) => {
      const input = (key, label, options = {}) => {
        const f = textInput({ label, value: item[key], disabled: !canEdit, ...options, onInput: (v) => { item[key] = v; } });
        f.input.addEventListener('blur', () => { total.textContent = totalText(); changed(); });
        return f.el;
      };
      const pictures = stack();
      const updatePicture = () => {
        const rec = photos.find((p) => photoIdOf(p) === item.photoId);
        const options = [['', 'Без рисунка'], ...photos.map((p, i) => [photoIdOf(p), p.photoId?.originalName || `Рисунок ${i + 1}`])];
        if (item.photoId && !rec) options.push([item.photoId, 'Прикреплённый рисунок']);
        pictures.replaceChildren(...[
          canEdit ? field('Рисунок модуля', select({ options, value: item.photoId, onChange: (id) => {
            item.photoId = id; updatePicture(); changed();
          } })) : null,
          rec ? passportSlot({ kind: 'module', label: 'Рисунок модуля', rec, canEdit: false }) : null,
          canEdit && productId() ? photoDrop({ purpose: 'passport', pickText: 'Загрузить рисунок',
            attach: async (id) => {
              const pid = productId();
              await attachProductFile(pid, id, 'passport', 'module');
              if (pid === productId() && rows.includes(item)) {
                item.photoId = String(id);
                changed();
                photoProduct = undefined;
                await loadPhotos();
              }
              return true;
            },
          }) : null,
        ].filter(Boolean));
      };
      photoUpdates.push(updatePicture);
      updatePicture();
      return section({ title: `Модуль ${index + 1}`, fixed: true, body: stack(
        input('name', 'Название', { max: 120, required: true }),
        fieldRow(input('dims', 'Габариты', { max: 60, placeholder: '2000×1200×90 мм' }),
          input('qty', 'Количество, шт.', { max: 5, inputmode: 'numeric', short: true, required: true })),
        pictures,
        // модуль с рисунком или названием — спросить: случайный клик не должен стирать работу (хвост C095)
        canEdit ? actions(button({ label: 'Убрать', size: 'S', onClick: async () => {
          if ((item.photoId || String(item.name || '').trim()) && !(await confirmDlg(`Убрать модуль ${index + 1}?`,
            `${String(item.name || '').trim() || 'Модуль'}${item.photoId ? ' и рисунок пропадут из паспорта' : ' пропадёт из паспорта'}. Файл останется в изделии.`,
            { okText: 'Убрать', danger: true }))) return;
          rows.splice(rows.indexOf(item), 1); draw(); changed();
        } })) : null,
      ) });
    });
    el.replaceChildren(...[
      !rows.length ? hint('Изделие собирается из модулей? Добавьте модули') : null,
      ...parts,
      rows.length >= 2 ? total : null,
      error,
      canEdit ? actions(
        button({ label: 'Добавить модуль', size: 'S', disabled: rows.length >= 20, onClick: () => {
          supplied = true;
          rows.push({ name: '', dims: '', qty: 1, photoId: '' });
          draw();
          el.querySelectorAll('input[aria-label="Название"]')[rows.length - 1]?.focus();
        } }),
        onDone && rows.length ? button({ label: 'Свернуть модули', size: 'S', onClick: async () => {
          changed(); await tail; if (error.hidden) onDone();
        } }) : null,
      ) : null,
    ].filter(Boolean));
    total.textContent = totalText();
  }

  const totalText = () => `Итого модулей: ${moduleTotal(rows)} шт.`;
  const total = hint('');
  const editor = {
    el, loadPhotos,
    async flush() {
      if (!save) return;
      changed();
      await tail;
      if (!error.hidden) throw new Error(error.textContent);
    },
    get value() { return supplied ? JSON.stringify(rows) : ''; },
    set value(next) {
      supplied = next != null && next !== '';
      const list = typeof next === 'string' ? JSON.parse(next || '[]') : next;
      rows = (Array.isArray(list) ? list : []).map((row) => ({ ...row, photoId: photoIdOf(row) }));
      saved = JSON.stringify(moduleRows(rows));
      report();
      draw();
    },
  };
  editor.value = value;
  return editor;
}
