import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum } from '../core/format.js';
import { patch } from '../core/router.js';
import { attachCombo } from './combo.js';
import { toast, toastError } from './toast.js';

/**
 * «Быстро заказать» на «Сегодня» (TASKS С2.1) — по рабочей схеме «Категория → Позиция из базы»:
 * категория, позиция (уже заказывали / есть на складе), количество → «Заказать» (заявка «Заказать» со всеми полями из базы).
 * Нет в списке — «Новая позиция…» открывает полную форму заявки справа с тем, что успели вписать.
 *   quickOrder({ load: async () => [{ label, cat, sub, values }], categories: () => [names], done() })
 */
export function quickOrder({ load, categories, done }) {
  let items = null; let catSel = ''; let picked = null;
  const cat = h('input', { placeholder: 'Категория' , 'aria-label': 'Категория' });
  const item = h('input', { placeholder: 'Сначала категория', 'aria-label': 'Позиция' });
  const q = h('input', { inputmode: 'decimal', value: '1', class: 'qo-q', 'aria-label': 'Количество' });
  const unit = h('span', { class: 'muted qo-u' }, 'шт');
  const go = h('button', { type: 'button', class: 'btn btn-primary' }, 'Заказать');
  const other = h('button', { type: 'button', class: 'btn btn-ghost', title: 'Нет в списке — полная форма заявки справа' }, 'Новая позиция…');
  const el = h('div', { class: 'qo' },
    h('div', { class: 'qo-row' }, h('div', { class: 'has-combo qo-cat' }, cat), h('div', { class: 'has-combo qo-item' }, item), q, unit, go),
    h('div', { class: 'qo-foot' }, h('span', { class: 'muted small' }, 'Уже заказывали или есть на складе — выберите: поставщик, ед. и артикул подставятся. Нет в списке —'), other));
  // подсказки грузятся при первом касании поля, а не при открытии экрана; пришли — обновить открытый список
  let ready = null;
  const ensure = () => (ready ??= load().then((x) => { items = x; }).catch(() => { items = []; })
    .then(() => { const a = document.activeElement; if (a === cat || a === item) a.dispatchEvent(new Event('focus')); }));
  cat.addEventListener('focus', ensure);
  item.addEventListener('focus', ensure);
  attachCombo(cat, { options: () => (categories() || []).map((c) => ({ label: c })), onPick: (o) => { catSel = o.label; picked = null; item.value = ''; item.placeholder = `Позиция из «${o.label}»`; item.focus(); } });
  cat.addEventListener('change', () => { const v = cat.value.trim().toLowerCase(); catSel = (categories() || []).find((c) => c.toLowerCase() === v) || ''; });
  attachCombo(item, {
    options: () => (items && catSel ? items.filter((x) => x.cat === catSel).map((x) => ({ label: x.label, sub: x.sub, x })) : []),
    empty: () => (catSel ? (items ? 'В этой категории ещё ничего не заказывали — «Новая позиция…»' : 'Загрузка…') : (cat.classList.add('need'), setTimeout(() => cat.classList.remove('need'), 1600), '← Сначала выберите категорию')),
    onPick: (o) => { picked = o.x; unit.textContent = o.x.values?.unit || 'шт'; q.focus(); q.select(); },
  });
  item.addEventListener('input', () => { if (picked && item.value !== picked.label) picked = null; });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
  other.addEventListener('click', () => patch({ of: 'requests', new: '1', open: undefined, title: item.value.trim() || undefined, categoryName: catSel || undefined, unit: picked?.values?.unit || undefined }));
  go.addEventListener('click', async () => {
    await ensure();
    if (!picked) { if (item.value.trim()) other.click(); else { toastError(new Error('Выберите категорию и позицию — или «Новая позиция…»')); (catSel ? item : cat).focus(); } return; }
    const n = parseNum(q.value);
    if (!(n > 0)) { toastError(new Error('Количество больше нуля')); q.focus(); return; }
    const v = picked.values || {};
    go.disabled = true;
    try {
      await api('/supply/requests', { method: 'POST', body: { title: picked.label, qty: n, unit: v.unit || 'шт', categoryName: v.categoryName || catSel, supplierName: v.supplierName || '', article: v.article || undefined, statusLabel: 'Заказать', priorityLabel: 'Обычный', clientUid: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) } });
      toast(`Заявка: ${picked.label} — ${n} ${v.unit || 'шт'}`);
      item.value = ''; picked = null; q.value = '1'; item.focus();
      done?.();
    } catch (e) { toastError(e); } finally { go.disabled = false; }
  });
  return el;
}
