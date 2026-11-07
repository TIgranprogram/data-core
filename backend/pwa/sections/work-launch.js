import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { badge, toast, sideForm, sideNote } from '../ui/kit/index.js';
import { patch } from '../core/router.js';
import { planLink } from './work-composition.js';

/*
 * «Запуск в работу» (правая панель): выбранные позиции заказа → у каждой «Маршрут изготовления» (виды работ по порядку).
 * Маршрут здесь не правится: части и работы позиции — в «Составе позиции» (sections/work-composition.js, план позиции).
 * Панель показывает итог плана каждой позиции; запуск — POST /work-tasks/launch {lineIds}. Позиции передаёт карточка заказа (sections/order-work.js) через openLaunch.
 */
const pending = new Map(); // ключ панели → { lines:[{ id, name, productId }], done(result) }

/** Открыть панель запуска для позиций; done(result) — после запуска (ответ сервера). */
export function openLaunch(lines, done, openSide) {
  const key = 'L' + Date.now().toString(36);
  const back = new URLSearchParams(location.hash.split('?')[1] || '').get('open'); // карточка заказа — вернуться в неё после запуска
  pending.set(key, { lines, done, back });
  openSide('worklaunch', key);
}

/** Итог плана позиции: части, работы, сколько проверено; ссылка в «Состав и работы». Запуск не запрещён и при непроверенном. */
function planSummary(line, plan) {
  const el = h('div', { class: 'field' });
  const show = { el, get value() { return ''; }, set value(_) { /* только показ */ } };
  if (!line.productId && !plan) {
    el.append(h('b', null, line.name), h('div', { class: 'muted' }, 'Нет изделия — составьте части и работы вручную в «Составе позиции» или сопоставьте позицию с «Продукцией»: карточка заказа → «Позиции» → «Подобрать изделие».'), planLink(line.id, { title: line.name }));
    return show;
  }
  const rows = [...(plan?.parts || []), ...(plan?.steps || [])];
  const ok = rows.filter((r) => r.checked).length;
  el.append(h('b', null, line.name),
    h('div', null, plan ? `Частей: ${plan.parts.length} · работ: ${plan.steps.length}` : 'План не загрузился'),
    !plan ? null : !plan.steps.length ? h('div', { class: 'muted' }, 'Работ нет — будет одна работа «Изготовление».') : badge(ok === rows.length ? 'всё проверено' : `проверено ${ok} из ${rows.length}`, ok === rows.length ? 'ok' : 'warn'),
    plan && ok < rows.length ? h('div', { class: 'muted' }, 'Не всё проверено — запустить можно, сервер напомнит.') : null,
    planLink(line.id, { title: line.name }));
  return show;
}

export const workLaunch = sideForm({
  id: 'worklaunch', title: 'Запуск в работу', noun: 'запуск',
  canEdit: () => !!session.canEdit,
  saveLabel: 'Запустить в работу',
  get: async (key) => {
    const p = pending.get(key);
    if (!p) throw new Error('Откройте запуск из карточки заказа заново');
    const plans = new Map(await Promise.all(p.lines.filter((l) => l.productId).map(async (l) => [l.id, await api('/orderline-plans/by-income/' + l.id).catch(() => null)])));
    return { key, lines: p.lines, plans };
  },
  heading: () => 'Запуск в работу',
  subheading: (r) => `позиций: ${r.lines.length}`,
  fields: async (r) => [
    { section: 'Маршрут изготовления каждой позиции', tone: 'main', fixed: true },
    { key: '_note', type: 'widget', label: '', wide: true, widget: () => ({ el: sideNote('Запуск берёт части и работы из плана позиции. Правка плана — по ссылке «Состав и работы»; в изделие она не пишется без вашего «И в продукцию».'), value: '' }) },
    ...r.lines.map((l) => ({ key: 'r_' + l.id, type: 'widget', label: '', wide: true, summary: () => '', widget: () => planSummary(l, r.plans.get(l.id) || null) })),
  ],
  toInitial: () => ({}),
  save: async (v, row) => {
    const p = pending.get(row.key);
    const res = await api('/work-tasks/launch', { method: 'POST', body: { lineIds: row.lines.map((l) => String(l.id)) } });
    const skip = (res.refused || []).length;
    const warn = (res.warnings || []).length;
    toast(res.created ? `Запущено в работу: ${res.created}${skip ? `, не запущено: ${skip}` : ''}` : `Не запущено: ${skip}`, { sub: skip ? 'Причины — в карточке заказа, блок «Работа»' : warn ? 'Есть предупреждения — в карточке заказа, блок «В работе»' : undefined });
    pending.delete(row.key);
    p?.done?.(res);
    if (p?.back) setTimeout(() => patch({ of: undefined, open: p.back }), 50); // панель закрылась — снова карточка заказа
    return { id: row.key };
  },
});
