import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { date } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { badge, fieldRow, link, textInput } from '../../ui/kit/index.js';
import { passports } from '../passports.js';
import { ourCompanies, numberOf, statusBadge } from './common.js';

/**
 * Вид «По номерам» (C072): таблица паспортов от новых номеров к старым, поиск по номеру, фирма, отбор «№ от — до».
 * Сверху — полоска «Последний № …» (общий ряд номеров и по каждой нашей фирме; нажатие на фирму отбирает её паспорта).
 * Сервер: GET /passports (numberFrom, numberTo, supplierOrgId, search), GET /passports/last-numbers.
 */
const fromFile = (r) => r.printSource === 'file' || !!r.printFile?.hasFile;

/** Полоска «Последний № 612 · СпортИН-ЮГ — 610 · СпортСтрой-Юг — 612». */
export function lastNumbersTop() {
  const box = h('p', { class: 'muted small' });
  api('/passports/last-numbers').then((d) => {
    if (!d?.last) { box.replaceChildren('Выпущенных паспортов с номером пока нет.'); return; }
    const firms = (d.byFirm || []).filter((f) => f.last);
    box.replaceChildren('Последний № ', h('b', null, String(d.last)),
      ...firms.flatMap((f) => [' · ', link({ label: `${f.name} — ${f.last}`, title: 'Показать паспорта этой фирмы', onClick: () => patch({ supplierOrgId: f.orgId, page: undefined }) })]));
  }).catch(() => { box.hidden = true; });
  return box;
}

/** Отбор «№ от — до»: два поля, применяются по Enter и при уходе из поля. */
function rangeFilter() {
  const apply = () => patch({ numberFrom: from.value.trim() || undefined, numberTo: to.value.trim() || undefined, page: undefined });
  const make = (label) => { const f = textInput({ label, inputmode: 'numeric', max: 9, onEnter: apply }); f.input.addEventListener('change', apply); return f; };
  const from = make('№ от'); const to = make('№ до');
  return { el: fieldRow(from.el, to.el), update: (P) => { from.value = P.numberFrom || ''; to.value = P.numberTo || ''; } };
}

export const passnums = {
  ...passports,
  id: 'passnums',
  title: 'Паспорта по номерам',
  form: undefined,
  remove: undefined,
  list: {
    ...passports.list,
    viewKey: 'passnums',
    sortDefault: '-passportNo',
    createLabel: false,
    bulk: undefined,
    gallery: undefined,
    sidebar: undefined,
    chipsTop: undefined,
    headActions: () => [],
    moreActions: undefined,
    top: () => lastNumbersTop(),
    extraKeys: ['numberFrom', 'numberTo'],
    toolbarExtra: () => rangeFilter(),
    searchPlaceholder: 'Поиск по номеру, названию, заказчику…',
    emptyText: 'Паспортов с такими номерами нет.', emptyHint: 'Измените отбор «№ от — до», фирму или строку поиска.',
    hints: { '': 'Все паспорта по порядку номеров: новые сверху. Введите номер в поиске или задайте «№ от — до». Клик — карточка.' },
    filters: [
      { key: 'status', label: 'Статус', type: 'select', options: async () => [{ value: 'issued', label: 'Выпущенные' }, { value: 'draft', label: 'Черновики' }, { value: 'annulled', label: 'Аннулированные' }] },
      { key: 'supplierOrgId', label: 'Фирма', type: 'select', options: async () => (await ourCompanies()).map((o) => ({ value: String(o.id), label: o.name || 'Фирма' })) },
      { key: 'numberFrom', label: '№ от', type: 'hidden' },
      { key: 'numberTo', label: '№ до', type: 'hidden' },
    ],
    columns: [
      { key: 'passportNumber', label: '№', sort: 'passportNo', cls: 'nowrap num', render: (r) => h('b', null, numberOf(r) || '—') },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) || '—' },
      { key: 'firm', label: 'Фирма', cls: 'clip', render: (r) => r.supplierOrg?.name || r.supplier || h('span', { class: 'muted' }, '—') },
      { key: 'name', label: 'Изделие', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name || '' }, r.name || h('span', { class: 'muted' }, 'без названия')) },
      { key: 'order', label: 'Заказ', cls: 'clip md-hide', render: (r) => [r.orderNo && '№' + r.orderNo, r.customerName].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—') },
      { key: 'source', label: 'Источник', cls: 'nowrap', render: (r) => (fromFile(r) ? badge('Файл', 'info') : badge('С сайта', 'ok')) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => statusBadge(r) },
    ],
  },
};
