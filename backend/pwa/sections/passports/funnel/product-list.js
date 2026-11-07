import { h } from '../../../core/dom.js';
import { button, posPic, searchBox, section, sideNote, sku, table } from '../../../ui/kit/index.js';

/**
 * Шаг 4 «Изделие»: поиск по всем изделиям, таблица подходящих (фото, артикул, название, «паспортов: N»), «+ Новое изделие».
 *   productList({ onPick(item), onNew(), onSearch(q) }) → { el, paint(resp.products), q() }
 * Поиск не сужается шагами (сервер ищет по всему каталогу); пусто — подсказка, что сделать.
 */
const photoOf = (p) => (typeof p === 'string' ? { url: p, thumb: p } : p);

export function productList({ onPick, onNew, onSearch }) {
  const sb = searchBox({ placeholder: 'Название или артикул', onSearch: (q) => onSearch?.(q) });
  const box = h('div', null);
  const newBtn = button({ label: '+ Новое изделие', size: 'S', title: 'Нет нужного в списке — создать по ходу', onClick: () => onNew?.() });
  const sec = section({ title: 'Изделие', count: 0, open: true, tone: 'main', body: [sb.el, box, newBtn] });

  function paint(products) {
    const items = products?.items || [];
    const total = products?.total ?? items.length;
    sec.querySelector('.k-sec-head .k-sec-n')?.replaceChildren(String(total));
    box.replaceChildren(...[
      table({ label: 'Изделия', clickable: true, maxHeight: 'M',
        // артикул — строкой под названием (DESIGN §4 «sku»): на 375 таблица не режется (приёмка D1)
        columns: [{ label: '' }, { label: 'Изделие' }, { label: 'Паспортов', num: true, hide: true }],
        rows: items.map((it) => ({ onClick: () => onPick?.(it), data: it.id,
          cells: [posPic(photoOf(it.photo), 'sm'), h('div', null, h('div', { title: it.name }, it.name), sku(it.sku)), it.passportsCount ? `паспортов: ${it.passportsCount}` : '—'] })),
        empty: { title: 'Изделий с такими признаками нет', hint: 'Снимите признак или создайте изделие кнопкой ниже.' } }),
      total > items.length ? sideNote(`Показано ${items.length} из ${total} — уточните признаки или поиск.`) : null].filter(Boolean));
  }
  /** Пока не выбрана категория и нет текста поиска — список и «+ Новое изделие» скрыты (нечего показывать). */
  const gate = (on) => { box.hidden = !on; newBtn.hidden = !on; };
  gate(false);
  return { el: sec, paint, gate, q: () => sb.input.value.trim() };
}
