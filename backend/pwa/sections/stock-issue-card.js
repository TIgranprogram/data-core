import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural, qty } from '../core/format.js';
import { buildForm, busyBlock, button, card, failBlock, qtyInput, sideNote, table } from '../ui/kit/index.js';

/*
 * Карточка одного склада в экране «Выдать материалы» (stock-issue.js): kit card variant table.
 * Сверху поиск и категория (kit buildForm), ниже таблица позиций склада (первые 100), в последней колонке — «Сколько» и «+».
 * Набранное количество уходит в общую корзину cart (Map id → { it, qty }); экран получает onChange().
 */
const LIMIT = 100;

/** warehouseCard({ zone: { id, name }, cart, onChange, onRemove }) → { el, reload, sync } */
export function warehouseCard({ zone, cart, onChange, onRemove }) {
  let cat = '';
  let text = '';
  let seq = 0;
  let timer = 0;
  const inputs = new Map();
  const cats = new Map(); // название категории → id
  const head = h('span', null);
  const box = h('div', null, busyBlock('позиции склада'));

  // поиск и категория — одна форма kit; следим за полями по имени
  const filters = buildForm([
    { key: 'q', type: 'text', label: 'Поиск', placeholder: 'Название или размер' },
    { key: 'cat', type: 'combo', label: 'Категория', placeholder: 'Все категории', strict: true,
      load: async () => { const r = await api('/stock/categories', { query: { zoneId: zone.id } }); cats.clear(); for (const c of r.items || []) if (c.id !== 'none') cats.set(c.name, c.id); return [...cats.keys()].map((n) => ({ value: n, label: n })); } },
  ], {});
  const wire = (name, fn) => { const el = filters.el.querySelector(`[name="${name}"]`); for (const t of ['input', 'change']) el?.addEventListener(t, fn); };
  wire('q', (e) => { clearTimeout(timer); timer = setTimeout(() => { const t = e.target.value.trim(); if (t !== text) { text = t; load(); } }, 250); });
  wire('cat', (e) => { const id = cats.get(e.target.value.trim()) || ''; if (id !== cat) { cat = id; load(); } });

  function qtyCell(it) {
    const free = it.free ?? it.quantity;
    const cell = qtyInput({ value: cart.get(it.id)?.qty ?? '', label: `Сколько: ${it.name}`, plusLabel: `Добавить: ${it.name}`, max: free, maxText: (f) => `Свободно только ${qty(f)}`,
      onInput: (n, text) => { if (n > 0) cart.set(it.id, { it, qty: text }); else cart.delete(it.id); onChange(); } });
    inputs.set(it.id, cell.input);
    return cell;
  }

  function paint(items, total) {
    inputs.clear();
    const rows = items.map((it) => ({
      data: it.id,
      cells: [it.article ? `${it.name} · ${it.article}` : it.name, qty(it.quantity), qty(it.free ?? it.quantity), it.unit || '', qtyCell(it)],
    }));
    const tbl = table({
      label: `Позиции склада «${zone.name}»`,
      columns: [{ label: 'Позиция' }, { label: 'Остаток', num: true }, { label: 'Свободно', num: true }, { label: 'Ед.' }, { label: 'Сколько' }],
      rows,
      empty: text || cat ? { kind: 'notFound', query: text } : { title: 'На этом складе нет позиций в наличии' },
    });
    box.replaceChildren(...[tbl, total > items.length ? sideNote(`Показано ${items.length} из ${total} — уточните поиск или категорию.`) : null].filter(Boolean));
    head.textContent = total ? `${total} ${plural(total, 'позиция', 'позиции', 'позиций')}` : '';
  }

  async function load() {
    const my = ++seq;
    box.replaceChildren(busyBlock('позиции склада'));
    try {
      const r = await api('/stock/items', { query: { zoneId: zone.id, limit: LIMIT, sort: 'name', status: 'ok,low,reserved', search: text || undefined, categoryId: cat || undefined } });
      if (my === seq) paint(r.items || [], r.total ?? (r.items || []).length);
    } catch (e) { if (my === seq) box.replaceChildren(failBlock(e, load)); }
  }
  load();

  const el = card({
    size: 'M', variant: 'table', title: zone.name, meta: head,
    actions: button({ label: 'Убрать склад', kind: 'ghost', size: 'S', onClick: onRemove }),
    body: [filters.el, box],
  });
  /** Корзина изменилась не здесь (убрали позицию справа) — перечитать числа в полях. */
  const sync = () => inputs.forEach((inp, id) => { inp.value = cart.get(id)?.qty ?? ''; });
  return { el, reload: load, sync };
}
