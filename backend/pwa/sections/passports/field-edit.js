import { buildForm } from '../../ui/kit/form.js';
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { actions, button, iconButton, select, field as kitField } from '../../ui/kit/index.js';
import { canEdit, canWorkPassport } from './common.js';


/** Один запрос изменения на паспорт, включая ожидание подтверждения. */
const pending = new Set();
export async function passportAction(id, action) {
  if (pending.has(id)) { toast('Дождитесь завершения предыдущего действия'); return; }
  pending.add(id);
  try { return await action(); } finally { pending.delete(id); }
}

const KIND_WORDS = { product: 'текст изделия', funnel: 'выбранный вариант текста изделия', element: 'справочник элементов', material: 'справочник материалов', defect: 'справочник дефектов', install: 'справочник способов установки' };
export const fieldSource = (ref) => ref ? KIND_WORDS[ref.kind] || 'справочник' : 'источник уточняется перед сохранением';

/** Общий редактор поля и пункта раздела; перенос в источник не изменяет снимок. */
export function fieldEditor({ r, ctx, field, index, sectionKey, itemKey, text, ref, cancel, rows = 3 }) {
  const releaseEdit = ctx.beginInlineEdit?.() || (() => {});
  const closeEditor = () => { releaseEdit(); cancel(); };
  const item = sectionKey !== undefined;
  const key = item ? { sectionKey, itemKey } : { field, ...(index === undefined ? {} : { index }) };
  const url = '/passports/' + r.id + (item ? '/snapshot-item' : '/snapshot-field');
  const form = buildForm([{ key: 'text', label: 'Текст строки', type: 'textarea', rows, wide: true, max: 50000 }], { text });
  const ta = form.el.querySelector('textarea');
  const source = h('div', { class: 'hint', 'aria-live': 'polite' }, 'Откуда строка: ' + (item ? 'шаблон типа паспорта' : fieldSource(ref)));
  const sourcePicker = h('div');
  let sourceSelect;
  let candidates;
  let working = false;
  const run = (sharedSave) => passportAction(r.id, async () => {
    if (working) return;
    working = true;
    const controls = [local, shared, back].filter(Boolean);
    controls.forEach((b) => { b.disabled = true; });
    const active = sharedSave ? shared : local;
    active.classList.add('is-busy');
    ta.disabled = true;
    if (sourceSelect) sourceSelect.disabled = true;
    const body = { ...key, text: ta.value };
    try {
      if (sharedSave) {
        if (!item && !ref) {
          if (!candidates) {
            const result = await api(url + '/sources', { method: 'POST', body: key });
            candidates = result.items || [];
            if (!candidates.length) {
              candidates = undefined;
              source.textContent = 'Для этой строки нет доступного источника. Можно сохранить только в этом паспорте.';
              return;
            }
            const currentText = h('p', { class: 'hint', 'aria-live': 'polite' }, 'Выберите источник, чтобы увидеть его нынешний текст.');
            const optionLabel = (x) => {
              const name = x.label.match(/«([^»]+)»/);
              return name ? name[1] + (x.label.match(/ · строка \d+$/)?.[0] || '') : x.label;
            };
            sourceSelect = select({ label: 'Куда сохранить строку', value: '', options: [['', 'Выберите источник…'], ...candidates.map((x) => [x.sourceKey, optionLabel(x)])], onChange: (value) => {
              const selected = candidates.find((x) => x.sourceKey === value);
              currentText.textContent = selected ? selected.label + '. Сейчас в источнике: ' + (selected.currentText || 'текст не заполнен') : 'Выберите источник, чтобы увидеть его нынешний текст.';
            } });
            sourcePicker.replaceChildren(kitField('Куда сохранить строку', sourceSelect), currentText);
            source.textContent = 'В старом паспорте источник не записан. Выберите подходящую запись справочника.';
            return;
          }
          if (!sourceSelect.value) { sourceSelect.focus(); return; }
          body.sourceKey = sourceSelect.value;
        }
        const target = await api(url + '/target', { method: 'POST', body });
        source.textContent = 'Источник: ' + target.target + '. Затронет изделий: ' + target.affected + '.';
        if (!(await confirmDlg('Сохранить в справочнике?', source.textContent + ' Новые сборки паспортов получат этот текст. Этот и выданные паспорта не изменятся.', { okText: 'Сохранить в справочнике' }))) return;
        await api(url + '/promote', { method: 'POST', body: { ...body, token: target.token } });
        toast('Сохранено: ' + target.target + '. Текст этого паспорта не изменён.');
        closeEditor();
      } else {
        await api(url, { method: 'PATCH', body });
        toast('Строка сохранена только в этом паспорте');
        try { const row = await api('/passports/' + r.id); releaseEdit(); ctx.setRow(row); }
        catch (e) { closeEditor(); toast('Текст сохранён. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
      }
    } catch (e) { toastError(e); }
    finally {
      working = false;
      controls.forEach((b) => { b.disabled = false; });
      active.classList.remove('is-busy');
      ta.disabled = false;
      if (sourceSelect) sourceSelect.disabled = false;
    }
  });
  const local = button({ label: 'Сохранить только в этом паспорте', kind: 'primary', onClick: () => run(false) });
  const shared = canEdit() ? button({ label: 'Сохранить в справочнике', onClick: () => run(true) }) : null;
  const back = button({ label: 'Отмена', kind: 'ghost', onClick: () => { if (!working) closeEditor(); } });
  const box = h('div', { class: 'field wide' }, form.el, source, sourcePicker, actions(local, shared, back));
  setTimeout(() => ta.focus(), 0);
  return box;
}

export function fieldPencil(view, args) {
  if (!canWorkPassport()) return null;
  return iconButton({ icon: '✎', label: 'Править строку', size: 'S', onClick: () => {
    const box = fieldEditor({ ...args, cancel: () => box.replaceWith(view) });
    view.replaceWith(box);
  } });
}
