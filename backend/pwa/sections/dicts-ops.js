import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn, failBlock } from '../ui/kit/busy.js';
import { qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { button, section, actions, badge, row, hint as hintKit } from '../ui/kit/index.js';
import { lookups } from './lookups.js';

/** Удаление строки справочника: свободное — с отменой; занятое — только переименовать. */
export async function removeDictItem({ dictKey, row, btn, reload }) {
  const fin = busyBtn(btn, null, { delay: 250 });
  let u;
  try { u = await api(`/dicts/${dictKey}/${row.id}/usage`); } catch (e) { fin(); toastError(e, 'Удалить'); return; }
  fin();
  if (!u.tracked || !u.busy) {
    if (!(await confirmDlg(`Удалить «${row.name}»?`, 'Значение пропадёт из списка. Вернуть можно сразу: кнопка «Отменить» после удаления.', { okText: 'Удалить', danger: true }))) return;
    try {
      await api(`/dicts/${dictKey}/${row.id}`, { method: 'DELETE' });
      lookups.reset?.();
      toast('Значение удалено', { undo: async () => { try { await api(`/dicts/${dictKey}/${row.id}/restore`, { method: 'POST' }); lookups.reset?.(); toast('Восстановлено'); await reload(); } catch (e) { toastError(e); } } });
      await reload();
    } catch (e) { toastError(e, 'Удалить'); }
    return;
  }
  const where = (u.sections || []).length ? u.sections.join(', ') : 'других разделах';
  const go = await confirmDlg(`«${row.name}» используется — удалить нельзя`, `Используется в: ${where}. Если название не подходит, переименуйте — оно изменится везде.`, { okText: 'Переименовать', cancelText: 'Закрыть' });
  if (go) patch({ of: 'dict', open: row.id, new: undefined });
}

/** «Найти в данных…»: кандидаты из заявок/склада/таблицы → добавить в справочник. */
export async function toggleDictCandidates({ cand, dictKey, reload, force }) {
  if (!cand.hidden && !force) { cand.hidden = true; return; }
  cand.hidden = false;
  cand.replaceChildren(h('p', { class: 'muted' }, 'Ищу в заявках, на складе и в Google-таблице…'));
  try {
    const r = await api(`/dicts/${dictKey}/candidates`);
    if (!r.items.length) {
      cand.replaceChildren(hintKit('Всё, что встречается в данных, уже есть в справочнике.'),
        button({ label: 'Закрыть', size: 'S', onClick: () => { cand.hidden = true; } }));
      return;
    }
    const boxes = r.items.map((c) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !c.similar;
      return { c, cb };
    });
    const go2 = button({ label: 'Добавить отмеченные', kind: 'primary', size: 'S' });
    go2.addEventListener('click', async () => {
      const names = boxes.filter((b) => b.cb.checked).map((b) => b.c.name);
      if (!names.length) { toast('Отметьте, что добавить', { error: true }); return; }
      go2.disabled = true; go2.textContent = 'Добавляю…';
      try {
        const res = await api(`/dicts/${dictKey}/import`, { method: 'POST', body: { names } });
        toast(`Добавлено: ${res.added}`); cand.hidden = true; lookups.reset?.(); await reload();
      } catch (e) { toastError(e); go2.disabled = false; go2.textContent = 'Добавить отмеченные'; }
    });
    cand.replaceChildren(
      section({ title: `Нашлось в данных, но нет в справочнике: ${r.items.length}`, open: true, body: [
        hintKit('Отмечено то, чего точно нет. «Похоже на …» — вероятно, то же самое другим написанием: такое лучше не добавлять, а потом объединить.'),
        ...boxes.map(({ c, cb }) => row({ lead: cb, title: c.name,
          meta: [c.uses ? `встречается ${qty(c.uses)} раз` : '', c.source].filter(Boolean).join(' · '),
          side: c.similar ? [badge(`похоже на «${c.similar.name}» ${Math.round(c.similar.score * 100)}%`, 'dim')] : null })),
        actions(go2, button({ label: 'Закрыть', size: 'S', onClick: () => { cand.hidden = true; } }))] }));
  } catch (e) { cand.replaceChildren(failBlock(e)); }
}
