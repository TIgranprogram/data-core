import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { plural } from '../core/format.js';
import * as kit from '../ui/kit/index.js';
import { canEdit } from './passports/common.js';
import { passportVariant } from './passports/dialogs.js';

/*
 * ПНЗ.2: правая панель «Паспорта заказа» (of=orderpass&open=<orderId>).
 * Сервер: GET /passports/order/:id/plan?variant, POST .../issue {lines?, variant}, GET .../pdf?variant (один PDF выпущенных).
 */
const STATE = { issued: ['Выпущен', 'ok'], ready: ['Готов к выпуску', 'info'], blocked: ['Не хватает данных', 'warn'] };

const missingText = (m) => {
  const a = m || [];
  return a.length <= 2 ? a.join('; ') : `${a.slice(0, 2).join('; ')} и ещё ${a.length - 2}`;
};

/** Открыть панель: из «По заказам» и из карточки заказа. */
export const openOrderPassports = (orderId) => go('docs', { tab: 'orders', of: 'orderpass', open: String(orderId) });

/** Кнопка «Паспорта заказа» (kit.button). */
export const orderPassportsButton = (orderId, size = 'S') => kit.button({ label: 'Паспорта заказа', size, title: 'Выпустить и распечатать паспорта по всем позициям заказа', onClick: () => openOrderPassports(orderId) });

const fetchPlan = (id) => api(`/passports/order/${id}/plan`, { query: { variant: passportVariant.value } });

function body(row, ctx) {
  const editable = canEdit();
  const readyN = row.ready || 0;
  const reload = async (extra) => ctx.setRow({ ...(await fetchPlan(row.orderId)), ...(extra || {}) });

  const seg = kit.segmented({
    label: 'Вариант паспорта',
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    value: passportVariant.value,
    onChange: async (k) => { passportVariant.value = k; try { await reload(); } catch (e) { kit.toastError(e, 'обновить план паспортов'); } },
  });

  const issueBtn = kit.button({
    label: `Выпустить готовые (${readyN})`, kind: 'primary', disabled: !editable || !readyN,
    title: readyN ? 'Выпустить паспорта по позициям, где всё заполнено' : 'Готовых к выпуску позиций нет',
    onClick: async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const r = await api(`/passports/order/${row.orderId}/issue`, { method: 'POST', body: { variant: passportVariant.value } });
        const n = (r.issued || []).length, m = (r.skipped || []).length;
        kit.toast(`Выпущено ${n}, пропущено ${m}`);
        window.dispatchEvent(new Event('data-changed'));
        await reload({ _skipped: r.skipped || [] });
      } catch (er) { b.classList.remove('is-busy'); b.disabled = false; kit.toastError(er, 'выпустить паспорта заказа'); }
    },
  });

  const printBtn = kit.button({
    label: 'Печать всех', disabled: !row.issued, title: row.issued ? 'Один PDF со всеми выпущенными паспортами заказа' : 'Сначала выпустите хотя бы один паспорт',
    onClick: async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const name = await apiFile(`/passports/order/${row.orderId}/pdf`, { query: { variant: passportVariant.value }, timeout: 600000, fallback: `Паспорта_заказ_${row.orderNo || ''}.pdf` });
        kit.toast(`Скачан: ${name}`);
      } catch (er) { kit.toastError(er, 'собрать PDF паспортов'); } finally { b.classList.remove('is-busy'); b.disabled = !row.issued; }
    },
  });

  const rows = (row.lines || []).map((l) => {
    const [label, tone] = STATE[l.state] || ['—', 'dim'];
    const last = l.state === 'issued' ? (l.passport?.number ? '№ ' + l.passport.number : 'выпущен')
      : l.state === 'blocked' ? h('span', null, missingText(l.missing), ' ', l.productId ? kit.link({ label: 'Шаблон паспорта', onClick: () => go('docs', { tab: 'templates', of: 'doctpl', open: l.productId }) }) : null)
        : 'можно выпускать';
    return { cells: [l.lineNo ?? '', l.title || '', h('span', null, kit.sku(l.article), l.article ? ' ' : '', l.productName || '—'), { v: String(l.qty ?? ''), cls: 'num' }, kit.badge(label, tone), last] };
  });

  const table = kit.table({
    label: 'Позиции заказа и паспорта',
    columns: [{ label: '№' }, { label: 'Позиция' }, { label: 'Изделие', hide: true }, { label: 'Кол-во', num: true }, { label: 'Состояние' }, { label: 'Паспорт / чего не хватает' }],
    rows,
    empty: { title: 'В заказе нет позиций с изделием', hint: 'Выберите изделие у позиции заказа — тогда здесь появится план паспортов.' },
  });

  const skipped = row._skipped?.length ? kit.section({
    title: 'Пропущено при выпуске', count: row._skipped.length, open: true,
    body: row._skipped.map((s) => kit.row({ title: s.title || 'Позиция', meta: s.reason, tone: 'warn' })),
  }) : null;

  return h('div', null,
    kit.stats([{ value: row.issued || 0, label: 'выпущено' }, { value: readyN, label: 'готово к выпуску' }, { value: row.blocked || 0, label: 'не хватает данных' }]),
    seg.el,
    table, skipped,
    kit.actions(issueBtn, printBtn, editable ? kit.button({ label: 'Паспорт по позиции', title: 'Выбрать позицию заказа и выпустить один паспорт', onClick: async () => { const { openPassportFunnel } = await import('./passports/funnel/open.js'); openPassportFunnel({ salesOrderId: row.orderId, orderNo: row.orderNo, customerName: row.customerName }); } }) : null),
    row.total ? h('p', { class: 'muted small' }, `Всего ${row.total} ${plural(row.total, 'позиция', 'позиции', 'позиций')}. Выпускаются только позиции, где заполнены все данные паспорта.`) : null);
}

export const orderpass = {
  id: 'orderpass',
  title: 'Паспорта заказа',
  kind: 'Паспорта',
  noun: 'паспорта заказа',
  canEdit: () => true,
  get: async (id) => ({ id, ...(await fetchPlan(id)) }),
  card: {
    heading: (r) => `Паспорта заказа · № ${r.orderNo || 'без номера'}${r.customerName ? ' · ' + r.customerName : ''}`,
    noHistory: true,
    view: () => [],
    extra: body,
  },
};
