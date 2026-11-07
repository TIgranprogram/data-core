import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { byType, index, typeValues } from '../core/facets.js';
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
  let type = ''; // '' — не выбран, '*' — «Все типы»
  let text = '';
  let seq = 0;
  let timer = 0;
  let catItems = []; // позиции выбранной категории склада (для шага «Тип»)
  const inputs = new Map();
  const head = h('span', null);
  const box = h('div', null, busyBlock('позиции склада'));

  // П-1: «Категория» → «Тип» — шаги воронки (фишки с числом позиций), позиции — после типа (или «Все типы») либо по тексту поиска (тогда по всему складу)
  let cats = [];
  const fun = funnel({ steps: [], onChange: (k, v) => { if (k === 'category') { cat = v || ''; type = ''; catItems = []; } else type = v || ''; paintSteps(); load(); } });
  const paintSteps = () => fun.update({ steps: [
    { key: 'category', label: 'Категория', ask: 'выберите категорию', skip: cats.length < 2, value: cat, values: cats.map((c) => ({ id: c.id, label: c.name, count: c.total })) },
    { key: 'type', label: 'Тип', ask: 'выберите тип', skip: typeValues(catItems).length < 3, value: type, values: typeValues(catItems) },
  ] });
  const filters = buildForm([{ key: 'q', type: 'text', label: 'Поиск по всему складу', placeholder: 'Название или размер' }], {});
  const input = filters.el.querySelector('[name="q"]');
  // только input (change на выходе из поля дублировал бы запрос); поле не пересоздаётся, таймер 300 мс
  input?.addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { const v = e.target.value.trim(); if (v !== text) { text = v; load(); } }, 300); });

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

  const typeSkipped = () => typeValues(catItems).length < 3; // нет типов или один — шаг «Тип» пропущен
  async function load() {
    const my = ++seq;
    if (!text && !cat && cats.length > 1) { box.replaceChildren(empty({ title: 'Выберите категорию', hint: 'Или найдите позицию поиском — он ищет по всему складу.' })); head.textContent = ''; return; }
    // таблица остаётся на месте, пока грузится новое: ширина карточки не прыгает; загрузочный блок — только если показывать нечего
    if (!box.firstChild || box.firstChild.classList?.contains('state')) box.replaceChildren(busyBlock('позиции склада'));
    try {
      if (text) {
        const r = await api('/stock/items', { query: { zoneId: zone.id, limit: LIMIT, sort: 'name', status: 'ok,low,reserved', search: text } });
        if (my === seq) paint(r.items || [], r.total ?? (r.items || []).length);
        return;
      }
      if (!catItems.length) {
        const r = await api('/stock/items', { query: { zoneId: zone.id, limit: 1000, sort: 'name', status: 'ok,low,reserved', categoryId: cat || undefined } });
        if (my !== seq) return;
        catItems = index(r.items || []);
        paintSteps();
      }
      if (!type && !typeSkipped()) { box.replaceChildren(empty({ title: 'Выберите тип', hint: 'Или «Все типы» — тогда покажем всё из категории.' })); head.textContent = ''; return; }
      const list = byType(catItems, type);
      paint(list.slice(0, LIMIT), list.length);
    } catch (e) { if (my === seq) box.replaceChildren(failBlock(e, load)); }
  }
  const init = () => api('/stock/categories', { query: { zoneId: zone.id } }).then((r) => { cats = (r.items || []).filter((c) => c.id !== 'none'); paintSteps(); load(); })
    .catch((e) => box.replaceChildren(failBlock(e, () => { box.replaceChildren(busyBlock('позиции склада')); init(); })));
  init();

  const el = card({
    size: 'M', variant: 'table', title: zone.name, meta: head,
    actions: button({ label: 'Убрать склад', kind: 'ghost', size: 'S', onClick: onRemove }),
    body: [fun.el, filters.el, box],
  });
  /** Корзина изменилась не здесь (убрали позицию справа) — перечитать числа в полях. */
  const sync = () => inputs.forEach((inp, id) => { inp.value = cart.get(id)?.qty ?? ''; });
  return { el, reload: () => { catItems = []; return load(); }, sync };
}
