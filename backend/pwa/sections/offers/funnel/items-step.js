import { money } from '../../../core/format.js';
import { button, hint, iconButton, qtyInput, row, searchBox, section, select, sku, stack } from '../../../ui/kit/index.js';
import { findProducts } from './api.js';

/**
 * Шаг 2 «Изделия» (поиск, добавить, количество) и шаг 3 «Цвет и размер» — только у изделий, где вариантов несколько.
 * Изделие без вариантов: цвет и размер не спрашиваем, берём единственный. Цена — из прошлого КП заказчика, иначе из каталога.
 *   itemsStep(S, { onChange, onDone }) → { el, variants() → узел|null }
 */
const many = (a) => Array.isArray(a) && a.length > 1;

export function itemsStep(S, { onChange, onDone }) {
  const found = h('div', null);
  const list = h('div', null);
  const sb = searchBox({ placeholder: 'Название или артикул изделия', minLength: 2, onSearch: async (q) => {
    if (q.trim().length < 2) { found.replaceChildren(); return; }
    const items = await findProducts(q.trim());
    found.replaceChildren(...(items.length
      ? items.map((p) => row({ title: p.name, meta: [p.sku, p.price ? money(p.price) : 'без цены'].filter(Boolean).join(' · '), onClick: () => add(p) }))
      : [hint('Ничего не найдено — уточните название или артикул.')]));
  } });

  function add(p) {
    const ex = S.lines.find((l) => l.id === p.id);
    if (ex) ex.qty += 1;
    else {
      const colors = Array.isArray(p.colors) ? p.colors.filter(Boolean) : [];
      const sizes = Array.isArray(p.sizes) ? p.sizes.filter(Boolean) : [];
      S.lines.push({
        id: p.id, sku: p.sku, name: p.name, unit: p.unit || 'шт', qty: 1, price: S.prices?.get(String(p.id)) ?? p.price ?? 0,
        colors, sizes, color: p.color || colors[0] || '', size: p.size || sizes[0] || '',
        photoUrl: p.photo?.thumb || p.photo?.url || '', description: String(p.description || '').trim(),
      });
    }
    sb.input.value = ''; found.replaceChildren(); paint(); onChange();
  }

  const warn = hint('', 'danger');
  const empty = hint('Найдите изделие по названию или артикулу и нажмите на него.');
  warn.hidden = true;
  const done = button({ label: 'Дальше', kind: 'primary', onClick: () => { if (S.lines.some((l) => !(l.qty > 0))) { warn.textContent = 'Укажите количество больше нуля.'; warn.hidden = false; return; } onDone(); } });
  function paint() {
    list.replaceChildren(...S.lines.map((l) => row({
      title: l.name, meta: sku(l.sku), wrap: true,
      side: [
        qtyInput({ value: String(l.qty), label: `Количество: ${l.name}`, onInput: (n) => { l.qty = n > 0 ? n : 0; onChange(); } }),
        iconButton({ icon: '×', label: `Убрать: ${l.name}`, size: 'S', onClick: () => { S.lines = S.lines.filter((x) => x !== l); paint(); onChange(); } }),
      ],
    })));
    done.hidden = !S.lines.length; empty.hidden = !!S.lines.length; warn.hidden = true;
  }
  const el = section({ title: 'Изделия', open: true, tone: 'main', body: [stack(sb.el, found, empty, list, warn, done)] });
  paint();

  /** Шаг 3: строки, у которых несколько цветов или размеров. Нет таких — null, шаг пропущен. */
  function variants() {
    const need = S.lines.filter((l) => many(l.colors) || many(l.sizes));
    if (!need.length) return null;
    return section({ title: 'Цвет и размер', open: true, tone: 'main', body: [stack(...need.map((l) => stack(
      row({ title: l.name }),
      many(l.colors) ? select({ label: `Цвет: ${l.name}`, options: l.colors.map((c) => [c, c]), value: l.color, onChange: (v) => { l.color = v; } }) : null,
      many(l.sizes) ? select({ label: `Размер: ${l.name}`, options: l.sizes.map((c) => [c, c]), value: l.size, onChange: (v) => { l.size = v; } }) : null,
    )))] });
  }
  return { el, variants };
}
