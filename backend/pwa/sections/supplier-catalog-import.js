import { h } from '../core/dom.js';
import { money, qty } from '../core/format.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { table, hint } from '../ui/kit/index.js';
/** Предпросмотр загрузки прайса (вынесено из supplier-catalog.js). */

const errLine = (text) => { const p = hint(text, 'danger'); p.classList.add('small'); return p; }; // строка ошибок файла, мелким
// ---------- импорт: окно с предпросмотром ----------
const ST = { new: ['Новая', 'ok'], price: ['Цена изменилась', 'warn'], update: ['Изменится', 'info'], same: ['Без изменений', ''], error: ['Ошибка', 'warn'] };

export function previewTable(res) {
  const c = res.counts || {};
  const rows = res.rows || [];
  const head = hint(`Строк: ${qty(c.total)} · новых: ${qty(c.new)} · цена изменилась: ${qty(c.price)} · изменится: ${qty(c.update)} · без изменений: ${qty(c.same)} · ошибок: ${qty(c.error)}`, c.error ? undefined : 'ok');
  const dup = res.duplicate ? hint('Этот файл уже загружали. Если загрузить ещё раз, изменений почти не будет.', 'danger') : null;
  const note = c.error ? hint('Строки с ошибками будут пропущены, остальные загрузятся.') : null;
  const trs = rows.slice(0, 300).map((r) => {
    const [label, tone] = ST[r.status] || [r.status, ''];
    return h('tr', null,
      h('td', { class: 'muted nowrap' }, String(r.rowNum)),
      h('td', null, h('span', { class: 'badge ' + tone }, label), r.errors?.length ? errLine(r.errors.join('; ')) : null),
      h('td', { class: 'muted nowrap' }, r.supplierName || '—'),
      h('td', { class: 'nowrap' }, r.article || '—'),
      h('td', null, r.name || '—', r.materialName ? h('div', { class: 'muted small' }, '→ ' + r.materialName) : null),
      h('td', { class: 'num nowrap' }, r.price != null ? (r.oldPrice != null && r.oldPrice !== r.price ? `${money(r.oldPrice)} → ` : '') + money(r.price) : '—'));
  });
  const preview = table({ columns: ['Строка', 'Что будет', 'Поставщик', 'Артикул', 'Название', 'Цена, ₽'].map((label) => ({ label })), rows: trs, maxHeight: 'M' });
  return [head, dup, note, preview, rows.length > 300 ? h('p', { class: 'muted small' }, `Показаны первые 300 из ${rows.length}`) : null];
}

/** Предпросмотр «Заказа от поставщика» (создаёт заявки и цены каталога): строки файла. */
export function orderPreview(rows) {
  const trs = rows.slice(0, 200).map((rw) => h('tr', null,
    h('td', null, rw.article), h('td', { class: 'clip' }, rw.name), h('td', null, rw.color),
    h('td', { class: 'num' }, rw.qty), h('td', null, rw.unit || 'шт'), h('td', null, rw.optGroup),
    h('td', { class: 'num' }, rw.price != null ? rw.price.toLocaleString('ru') + ' ₽' : '—')));
  return [hint(`Найдено строк: ${rows.length}${rows.length > 200 ? ' (показаны первые 200)' : ''}`, 'ok'),
    table({ columns: ['Артикул', 'Название', 'Цвет', 'Кол-во', 'Ед.', 'Группа', 'Цена'].map((label) => ({ label })), rows: trs, maxHeight: 'M' })];
}
// 2026-10-26: «Кол-во» — сколько заказать в этих единицах (пусто = 1); «Ед. изм.» — шт / м / кг / упак (пусто = шт); «Цена» — за 1 единицу
export const orderTemplate = () => downloadXlsx('шаблон-прайса.xlsx', [['Артикул', 'Название', 'Цвет', 'Ед. изм.', 'Кол-во', 'Группа', 'Цена'],
  ['АРТ-001', 'Качели двойные', 'Зелёный', 'шт', 1, 'Качели', 12500], ['АРТ-002', 'Труба 40×20×2', '', 'м', 6, 'Металл', 210]], 'Прайс');

