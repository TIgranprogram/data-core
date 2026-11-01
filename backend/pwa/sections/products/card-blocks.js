import { session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { date, money, qty } from '../../core/format.js';
import { go } from '../../core/router.js';
import { button as kitButton, row as kitRow, empty as kitEmpty, toast } from '../../ui/kit/index.js';
import { suggestLink } from '../../ui/composition-suggest.js';
import { clearNoteWarning, resetPdCategory } from './data.js';

/* Блоки правой панели изделия (вид): примечание-предупреждение, состав, документация, «В заказах», категория паспорта. */

export const STATUS = { draft: 'без цены', active: 'в продаже', new: 'новое', archived: 'архив' };
export const dims = (d) => (d ? `${['length', 'width', 'height'].map((k) => (d[k] ? qty(d[k]) : '—')).join(' × ')} ${d.unit || 'мм'}` : null);
export { grp } from '../../ui/kit/index.js';

/** Категория паспорта в карточке: что задано в изделии, что унаследовано от группы/раздела, куда идти, если не задано. */
export function passportCatView(r, ctx) {
  const pc = r.passportCategory;
  const lbl = (c) => (c ? `${c.name || c.code}` : '');
  const where = r.group ? `группы «${r.group}»` : r.type ? `раздела «${r.type}»` : '';
  if (pc?.own) {
    const inh = pc.inherited;
    const reset = kitButton({ label: 'Сбросить', kind: 'ghost', size: 'S', onClick: async () => {
      try { const fresh = await resetPdCategory(r); toast('Категория сброшена'); ctx?.setRow?.(fresh); } catch (e) { toast(e.message || 'Не удалось сбросить'); }
    } });
    return h('span', null, `${lbl(pc.own)} — задана в самом изделии`, inh && inh.code !== pc.own.code ? ` (${r.group ? `у группы «${r.group}»` : 'по группе'}: ${lbl(inh)})` : '', ' ', reset);
  }
  const cur = pc?.inherited || (pc && pc.code ? pc : null);
  if (cur) return `${cur.name || cur.code}${cur.via ? ` (${cur.via})` : ''}`;
  if (!where) return null;
  return h('span', { class: 'muted' }, `У ${where} не задана категория паспорта. Выберите её в «Продукция → Категории» (строка ${r.group ? 'группы' : 'раздела'}, поле «Категория паспорта»)`);
}

// Пометка скрипта переноса каталога («⚠ Проверить …»): жёлтая плашка; «Готово» снимает строки с ⚠ из примечания
export function warnNote(r) {
  if (!r.notes || !r.notes.startsWith('⚠')) return null;
  const rest = r.notes.split('\n').filter((l) => !l.trim().startsWith('⚠')).join('\n').trim();
  return h('div', { style: 'background:var(--warn-soft);border:1px solid var(--warn);border-radius:8px;padding:.6rem .8rem;margin-bottom:.8rem;display:flex;gap:.8rem;align-items:flex-start;justify-content:space-between' },
    h('div', { style: 'white-space:pre-wrap' }, r.notes),
    session.canEdit ? kitButton({ label: 'Готово', size: 'S', title: 'Проверено — убрать пометку', onClick: () => clearNoteWarning(r, rest) }) : null);
}

// «Состав» (БЗ-5): материалы склада, из которых сделано изделие; правка — в правой панели.
// Себестоимость материалов (тем, кто видит деньги): цена — последняя закупка, иначе справочник материалов
export function compositionBlock(r) {
  const items = r.composition || [];
  const cost = session.canMoney ? r.cost : null;
  // СИ: строки трёх видов; цена — по виду и ссылке (материал — закупка/справочник, изделие — по его составу)
  const price = new Map((cost?.lines || []).map((x) => [`${x.lineType || 'material'}:${x.refId || x.materialId}`, x]));
  const priceText = (l) => {
    const p = price.get(`${l.lineType || 'material'}:${l.refId || l.materialId}`);
    if (!cost || l.raw) return '';
    if (!p || p.price == null) return ' · цены нет';
    const src = p.source === 'reference' ? ' (справочник)' : p.source === 'composition' ? ` (по составу${p.partial ? ', не всё с ценой' : ''})` : p.date ? ` (закупка ${date(p.date)})` : '';
    return ` · ${money(p.price)}/${l.unit} = ${money(p.sum)}${src}`;
  };
  const line = (l) => kitRow({ title: l.name, meta: `${qty(l.quantity)} ${l.unit}${l.article ? ' · ' + l.article : ''}${priceText(l)}`,
    below: l.lineType === 'product' && l.children?.length ? h('details', { class: 'comp-nested' }, h('summary', null, `его состав: ${l.children.length}`),
      h('ul', null, ...l.children.map((c) => h('li', null, `${c.name} · ${qty(c.quantity)} ${c.unit}`)))) : null });
  const groups = [['material', 'Материалы'], ['product', 'Изделия'], ['module', 'Модули (CRM)']].map(([t, title]) => [title, items.filter((l) => (l.lineType || 'material') === t || (t === 'module' && l.raw))]).filter(([, l]) => l.length);
  return h('div', null, h('div', { class: 'section-title' }, `Состав${items.length ? ` (${items.length})` : ''}`),
    items.length ? h('div', null, ...groups.map(([title, list]) => h('div', null, groups.length > 1 ? h('b', null, title) : null, h('div', null, ...list.map(line)))))
      : kitEmpty({ title: 'Состав не заполнен', hint: 'Нажмите «Изменить состав» в действиях карточки: добавьте материалы и узлы.' }),
    cost ? h('p', null, h('b', null, `Себестоимость ≈ ${money(cost.total)}`),
      h('span', { class: 'muted' }, cost.missing ? ` · без цены: ${cost.missing} — в сумму не вошли` : ' · материалы — по последним закупкам, изделия — по их составу')) : null);
}

// «Паспорта» (БЗ-5): выпущенные паспорта этого изделия — по ссылке или по названию
export function passportsBlock(r) {
  const p = r.passports;
  const tpl = h('div', null, kitButton({ label: 'Шаблон паспорта', kind: 'primary', size: 'S', onClick: () => go('docs', { tab: 'templates', of: 'doctpl', open: r.id }) }));
  if (!p?.total) return h('div', null, h('div', { class: 'section-title' }, 'Документация'), h('p', { class: 'muted' }, 'Паспортов пока нет. Откройте шаблон: там видно, что собрано и чего не хватает.'), tpl);
  return h('div', null, h('div', { class: 'section-title' }, 'Документация'), tpl, h('div', { class: 'section-title' }, `Паспорта (${p.total})`),
    h('ul', { class: 'timeline' }, ...p.items.map((x) => h('li', null,
      h('a', { href: '#passports?open=' + x.id }, `№ ${x.passportNumber || '—'}`),
      h('span', { class: 'muted clip' }, [date(x.date), x.customer, x.orderNo ? 'заказ ' + x.orderNo : ''].filter(Boolean).join(' · '))))),
    p.total > p.items.length ? h('p', { class: 'muted' }, `показаны последние ${p.items.length}`) : null);
}

// «Где в заказах» (БЗ-5): позиции заказов с этим изделием (по ссылке или по совпадению названия) — только просмотр
export function inOrders(r) {
  const items = r.orderLines || [];
  if (!items.length) return h('div', null, h('div', { class: 'section-title' }, 'В заказах'), h('p', { class: 'muted' }, 'Изделие ещё не встречается в заказах'));
  return h('div', null, h('div', { class: 'section-title' }, `В заказах (${items.length})`),
    h('ul', { class: 'timeline' }, ...items.map((l) => h('li', null,
      h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`),
      h('span', { class: 'muted clip' }, [l.customer, l.qty != null ? `${qty(l.qty)} шт.` : '', l.color, l.size, l.shipDate ? 'отгрузка ' + date(l.shipDate) : ''].filter(Boolean).join(' · ')),
      l.linked ? suggestLink(l.id) : null))));
}

/** Варианты изделия (ВР): основное и другие варианты семейства — размеры, цвет; переход по ссылке. */
export function variantsBlock(r) {
  const items = r.variants || [];
  if (!items.length) return null;
  return h('div', null, h('div', { class: 'section-title' }, `Другие варианты (${items.length})`),
    h('ul', { class: 'timeline' }, ...items.map((v) => h('li', null,
      h('a', { href: '#products?open=' + v.id }, `арт. ${v.sku || '—'}`),
      h('span', { class: 'muted clip' }, [v.isBase ? 'основное' : '', v.name, dims(v.dimensions), (v.colors || []).join(', ')].filter(Boolean).join(' · '))))));
}
