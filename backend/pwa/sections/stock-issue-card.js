import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural, qty } from '../core/format.js';
import { buildForm, busyBlock, button, card, empty, failBlock, funnel, qtyInput, sideNote, table } from '../ui/kit/index.js';

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
  const head = h('span', null);
  const box = h('div', null, busyBlock('позиции склада'));

  // П-1: «Категория» — шаг воронки (фишки с числом позиций), позиции — только после выбора категории или по тексту поиска (тогда по всему складу)
  let cats = [];
  const fun = funnel({ steps: [], onChange: (_k, v) => { cat = v || ''; paintCats(); load(); } });
  const paintCats = () => fun.update({ steps: [{ key: 'category', label: 'Категория', ask: 'выберите категорию', skip: cats.length < 2, value: cat, values: cats.map((c) => ({ id: c.id, label: c.name, count: c.total })) }] });
  const filters = buildForm([{ key: 'q', type: 'text', label: 'Поиск по всему складу', placeholder: 'Название или размер' }], {});
  const input = filters.el.querySelector('[name="q"]');
  for (const t of ['input', 'change']) input?.addEventListener(t, (e) => { clearTimeout(timer); timer = setTimeout(() => { const v = e.target.value.trim(); if (v !== text) { text = v; load(); } }, 250); });

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
      empty: text ? { kind: 'notFound', query: text } : { title: 'В категории нет позиций в наличии' },
    });
    box.replaceChildren(...[tbl, total > items.length ? sideNote(`Показано ${items.length} из ${total} — уточните поиск или категорию.`) : null].filter(Boolean));
    head.textContent = total ? `${total} ${plural(total, 'позиция', 'позиции', 'позиций')}` : '';
  }

  async function load() {
    const my = ++seq;
    if (!text && !cat && cats.length > 1) { box.replaceChildren(empty({ title: 'Выберите категорию', hint: 'Или найдите позицию поиском — он ищет по всему складу.' })); head.textContent = ''; return; }
    box.replaceChildren(busyBlock('позиции склада'));
    try {
      const r = await api('/stock/items', { query: { zoneId: zone.id, limit: LIMIT, sort: 'name', status: 'ok,low,reserved', search: text || undefined, categoryId: text ? undefined : cat || undefined } });
      if (my === seq) paint(r.items || [], r.total ?? (r.items || []).length);
    } catch (e) { if (my === seq) box.replaceChildren(failBlock(e, load)); }
  }
  const init = () => api('/stock/categories', { query: { zoneId: zone.id } }).then((r) => { cats = (r.items || []).filter((c) => c.id !== 'none'); paintCats(); load(); })
    .catch((e) => box.replaceChildren(failBlock(e, () => { box.replaceChildren(busyBlock('позиции склада')); init(); })));
  init();

  const el = card({
    size: 'M', variant: 'table', title: zone.name, meta: head,
    actions: button({ label: 'Убрать склад', kind: 'ghost', size: 'S', onClick: onRemove }),
    body: [fun.el, filters.el, box],
  });
  /** Корзина изменилась не здесь (убрали позицию справа) — перечитать числа в полях. */
  const sync = () => inputs.forEach((inp, id) => { inp.value = cart.get(id)?.qty ?? ''; });
  return { el, reload: load, sync };
}
