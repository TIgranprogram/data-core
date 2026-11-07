import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { money, plural, qty } from '../core/format.js';
import { actions, busyBlock, button, confirmDlg, failBlock, hint, readonlyGroup, section, table, toast, toastError } from '../ui/kit/index.js';

/*
 * Факт работ, нормы и себестоимость (C041 Э3):
 *   — «Работы: фактически» в карточке изделия: медиана факта по последним заказам (GET /work-facts/product/:id)
 *     и кнопка «Принять как норму» (POST …/apply) — фактические часы записываются в маршрут изделия;
 *   — «Себестоимость» позиции заказа (incomeId) или изделия (productId): материалы + работы по ставкам
 *     (GET /work-facts/cost). Без галочки «Деньги» сервер отдаёт {hidden:true} — блок не показываем;
 *   — отметка «начал / закончил» у шага плана позиции (POST /orderline-plans/:id/steps/:stepId/mark)
 *     для панели «Состав и работы» (work-composition.js).
 * Только эталоны kit (section, table, readonlyGroup, hint, button): своих классов и стилей нет.
 */
const FACTS = '/work-facts';

/** Факт по изделию: [{orders, used[], steps[], total}] — медиана последних заказов с отмеченным концом работ. */
export const factsOfProduct = (productId) => api(`${FACTS}/product/${productId}`);
/** «Принять как норму»: фактические часы → маршрут изделия. Ответ: { applied, skipped, totalHours }. */
export const applyNorm = (productId) => api(`${FACTS}/product/${productId}/apply`, { method: 'POST' });
/** Себестоимость позиции заказа или изделия; без права «Деньги» — { hidden: true }. */
export const costOf = ({ incomeId, productId } = {}) => api(`${FACTS}/cost`, { query: incomeId ? { incomeId } : { productId } });
/** Отметка шага плана: what = 'start' | 'finish'. Ответ: { bar, rev }. */
export const markStep = (planId, stepId, what) => api(`/orderline-plans/${planId}/steps/${stepId}/mark`, { method: 'POST', body: { what } });

const hrs = (v) => (v == null || v === '' ? '—' : qty(v));
const wholeProduct = 'Изделие целиком';

/** Тело секции «Себестоимость»: материалы, работы по ставкам, итог. */
function costBody(c) {
  const body = [];
  const m = c.materials;
  const rows = [['Материалы', m ? money(m.total) : 'не заданы']];
  if (m?.missing) rows.push(['Без цены, позиций', String(m.missing)]);
  if (c.qty != null) rows.push(['Количество', `${qty(c.qty)} шт.`]);
  body.push(readonlyGroup({ rows }));
  if (m?.missing) body.push(hint(`Материалы без цены: ${m.missing} — в сумму не вошли.`, 'warn'));
  const w = c.works;
  if (w?.lines?.length) {
    body.push(table({
      label: 'Работы в себестоимости',
      columns: [{ label: 'Вид работ' }, { label: 'Часть', wrap: true }, { label: 'Часы', num: true }, { label: 'Ставка', num: true }, { label: 'Сумма', num: true }],
      rows: w.lines.map((l) => ({ cells: [l.workTypeName || 'работа', l.partName || wholeProduct, hrs(l.hours), l.rate != null ? money(l.rate) : 'нет', money(l.sum)] })),
      foot: [h('tr', null, h('td', { colspan: '2' }, 'Итого работ'), h('td', { class: 'num right' }, hrs(w.hours)), h('td'), h('td', { class: 'num right' }, money(w.total)))],
    }));
  } else body.push(hint('Работ нет — в себестоимость входят только материалы.'));
  // ставка: человека, нет — вида работ (DECISIONS Q4); без обеих час в сумму не вошёл
  if (w?.missingRate) body.push(hint(`нет ставки: ${w.missingRate} — часы без ставки в сумму не вошли.`, 'warn'));
  body.push(readonlyGroup({ rows: [['Всего', money(c.total) || '—']] }));
  return body;
}

/**
 * costBlock({ incomeId?, productId? }) → details.k-sec «Себестоимость» (tone money) с загрузкой по месту.
 * Нет права «Деньги» — null (блок не строится); сервер прислал {hidden:true} — секция скрывается.
 */
export function costBlock({ incomeId, productId } = {}) {
  if (!session.canMoney) return null;
  const box = h('div', null, busyBlock('себестоимость'));
  const sec = section({ title: 'Себестоимость', tone: 'money', body: box });
  async function load() {
    box.replaceChildren(busyBlock('себестоимость', { retry: load }));
    let c;
    try { c = await costOf({ incomeId, productId }); }
    catch (e) { box.replaceChildren(failBlock(e, load)); return; }
    if (!c || c.hidden) { sec.hidden = true; box.replaceChildren(); return; }
    sec.hidden = false;
    box.replaceChildren(...costBody(c));
  }
  load();
  return sec;
}

/** Тело секции «Работы: фактически»: таблица по шагам, итог, «Принять как норму». */
function factsBody(d, reload, onApplied) {
  const total = d.total || {};
  const body = [hint(`Фактические часы — медиана по ${d.orders} ${plural(d.orders, 'заказу', 'заказам', 'заказам')} с отметками работ.`)];
  body.push(table({
    label: 'Факт работ по изделию',
    columns: [{ label: 'Вид работ' }, { label: 'Часть', wrap: true }, { label: 'Норма, ч', num: true }, { label: 'Фактически, ч', num: true }, { label: 'По заказам', num: true }],
    empty: { title: 'Работ с фактом нет', hint: 'Часы появятся, когда в заказах отметят начало и конец работ.' },
    rows: (d.steps || []).map((s) => ({ cells: [s.workTypeName || 'работа', s.partName || wholeProduct, hrs(s.normHours), hrs(s.hoursPerUnit), s.sample ? String(s.sample) : '—'] })),
    foot: [h('tr', null, h('td', { colspan: '2' }, 'Итого'), h('td', { class: 'num right' }, hrs(d.normTotalHours)), h('td', { class: 'num right' }, hrs(total.hoursPerUnit)), h('td', { class: 'num right' }, total.sample ? String(total.sample) : '—'))],
  }));
  if (total.daysPerUnit != null) body.push(hint(`Срок по факту: ${qty(total.daysPerUnit)} дн.`));
  if (session.canEdit) body.push(actions(button({
    label: 'Принять как норму', kind: 'primary', size: 'S', title: 'Записать фактические часы в нормы изделия — новые заказы получат эту оценку',
    onClick: async () => {
      if (!(await confirmDlg('Принять как норму?', 'Нормы часов изделия заменятся фактическими. Новые заказы получат эту оценку; в открытых позициях появится «Взять заново».', { okText: 'Принять' }))) return;
      try {
        const r = await applyNorm(d.productId);
        const n = Number(r?.applied) || 0;
        toast(`Норма обновлена: ${n} ${plural(n, 'работа', 'работы', 'работ')}`, { sub: r?.skipped ? `пропущено: ${r.skipped}` : undefined });
        if (onApplied) await onApplied(); else await reload();
      } catch (e) { toastError(e, 'принять норму'); }
    },
  })));
  return body;
}

/**
 * factsBlock(product, { onApplied? }) → details.k-sec «Работы: фактически» (tone info) в карточке изделия.
 * Нет факта — одна подсказка, как его получить. «Принять как норму» обновляет блок и «Части и работы» (onApplied).
 */
export function factsBlock(product, { onApplied } = {}) {
  const inner = h('div', null, busyBlock('факт работ'));
  const sec = section({ title: 'Работы: фактически', tone: 'info', body: inner });
  async function load() {
    inner.replaceChildren(busyBlock('факт работ', { retry: load }));
    let d;
    try { d = await factsOfProduct(product.id); }
    catch (e) { inner.replaceChildren(failBlock(e, load)); return; }
    if (!d?.orders) { inner.replaceChildren(hint('Факта пока нет: отметьте «Начал» и «Закончил» у работ в панели «Позиция заказа» → «Состав».')); return; }
    inner.replaceChildren(...factsBody(d, load, onApplied));
  }
  load();
  return sec;
}
