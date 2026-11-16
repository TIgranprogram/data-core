// C134: «В справочник» в окне паспорта — выбор записи справочника для старых паспортов без ссылки на источник (как field-edit.js).
import { h } from '../../core/dom.js';
import { select } from '../../ui/kit/index.js';

/** Возвращает { key } — можно сохранять; { stop: 'текст' } — показать текст и ждать действия. */
export async function pickSourceKey(shared, box, state) {
  if (!shared.needsSource) return { key: undefined };
  if (!state.sel) {
    const items = await shared.sources();
    if (!items.length) return { stop: 'Для этой строки нет источника в справочнике. Сохраните только в этом паспорте.' };
    if (items.length === 1) return { key: items[0].sourceKey };
    state.sel = select({ label: 'Куда сохранить', value: '', options: [['', 'Выберите запись справочника…'], ...items.map((x) => [x.sourceKey, x.label])] });
    box.insertBefore(h('div', { class: 'bk-ed-row' }, state.sel), box.lastChild);
    return { stop: 'Выберите запись справочника и нажмите «В справочник» ещё раз.' };
  }
  const v = state.sel.querySelector?.('select')?.value ?? state.sel.value;
  return v ? { key: v } : { stop: 'Выберите запись справочника.' };
}
