import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, toast, sideForm, sideNote, actions } from '../ui/kit/index.js';
import { patch } from '../core/router.js';
import { workTypes } from './work-route.js';

/*
 * «Запуск в работу» (правая панель): выбранные позиции заказа → у каждой «Как делается» (виды работ по порядку).
 * У изделия маршрут уже есть — показан, можно изменить; нет — выбираем виды работ кнопками по порядку нажатия.
 * Сохранение: изменённые маршруты пишутся в изделие (PUT /work-routes/:productId — в следующий раз подставится сам),
 * затем POST /work-tasks/launch {lineIds}. Позиции передаёт карточка заказа (sections/order-work.js) через openLaunch.
 */
const pending = new Map(); // ключ панели → { lines:[{ id, name, productId }], done(result) }

/** Открыть панель запуска для позиций; done(result) — после запуска (ответ сервера). */
export function openLaunch(lines, done, openSide) {
  const key = 'L' + Date.now().toString(36);
  const back = new URLSearchParams(location.hash.split('?')[1] || '').get('open'); // карточка заказа — вернуться в неё после запуска
  pending.set(key, { lines, done, back });
  openSide('worklaunch', key);
}

/** Выбор видов работ по порядку: нажал — добавился в конец, нажал ещё раз — убран. value — JSON { productId, steps:[id], changed }. */
function routePicker(line, types, steps0) {
  let steps = [...steps0], editing = !steps0.length, changed = false;
  const el = h('div', { class: 'field' });
  const name = (id) => types.find((t) => t.value === id)?.label || 'вид работ удалён';
  const paint = () => {
    const chain = steps.length ? steps.map((id, i) => `${i + 1}. ${name(id)}`).join(' → ') : '';
    el.replaceChildren(
      h('b', null, line.name),
      !line.productId ? h('div', { class: 'muted' }, 'Нет изделия — не запустится. Сопоставьте позицию с «Продукцией»: карточка заказа → «Позиции» → «Подобрать изделие».') :
        steps.length ? h('div', null, chain) : h('div', { class: 'muted' }, 'Не задано, как делается — выберите виды работ по порядку. Иначе будет одна работа «Изготовление».'),
      line.productId && !editing ? button({ label: 'Изменить работы', size: 'S', kind: 'ghost', onClick: () => { editing = true; paint(); } }) : null,
      line.productId && editing ? actions(
        ...types.map((t) => {
          const at = steps.indexOf(t.value);
          return button({ label: at >= 0 ? `${at + 1}. ${t.label}` : t.label, size: 'S', kind: at >= 0 ? 'primary' : 'secondary',
            onClick: () => { steps = at >= 0 ? steps.filter((x) => x !== t.value) : [...steps, t.value]; changed = true; paint(); el.dispatchEvent(new Event('change', { bubbles: true })); } });
        })) : null);
  };
  paint();
  return { el, get value() { return JSON.stringify({ productId: line.productId || null, steps, changed }); }, set value(_) { /* только своё состояние */ } };
}

export const workLaunch = sideForm({
  id: 'worklaunch', title: 'Запуск в работу', noun: 'запуск',
  canEdit: () => !!session.canEdit,
  saveLabel: 'Запустить в работу',
  get: async (key) => {
    const p = pending.get(key);
    if (!p) throw new Error('Откройте запуск из карточки заказа заново');
    const types = await workTypes();
    const ids = [...new Set(p.lines.map((l) => l.productId).filter(Boolean))];
    const routes = new Map(await Promise.all(ids.map(async (id) => [id, ((await api('/work-routes/' + id).catch(() => ({ steps: [] }))).steps || []).map((s) => String(s.workTypeId))])));
    return { key, lines: p.lines, types, routes };
  },
  heading: () => 'Запуск в работу',
  subheading: (r) => `позиций: ${r.lines.length}`,
  fields: async (r) => [
    { section: 'Как делается каждая позиция', tone: 'main', fixed: true },
    { key: '_note', type: 'widget', label: '', wide: true, widget: () => ({ el: sideNote('Виды работ — колонки доски «В работе». Выбор запомнится в изделии: в следующий раз подставится сам.'), value: '' }) },
    ...r.lines.map((l) => ({ key: 'r_' + l.id, type: 'widget', label: '', wide: true, summary: () => '', widget: () => routePicker(l, r.types, r.routes.get(l.productId) || []) })),
  ],
  toInitial: () => ({}),
  save: async (v, row) => {
    const p = pending.get(row.key);
    // один маршрут на изделие: последний изменённый выбор по этому изделию
    const byProduct = new Map();
    for (const l of row.lines) { const x = v['r_' + l.id]; if (x?.changed && x.productId) byProduct.set(x.productId, x.steps); }
    for (const [pid, steps] of byProduct) await api('/work-routes/' + pid, { method: 'PUT', body: { steps: steps.map((workTypeId) => ({ workTypeId })) } });
    const res = await api('/work-tasks/launch', { method: 'POST', body: { lineIds: row.lines.map((l) => String(l.id)) } });
    const skip = (res.refused || []).length;
    toast(res.created ? `Запущено в работу: ${res.created}${skip ? `, не запущено: ${skip}` : ''}` : `Не запущено: ${skip}`, { sub: skip ? 'Причины — в карточке заказа, блок «Работа»' : undefined });
    pending.delete(row.key);
    p?.done?.(res);
    if (p?.back) setTimeout(() => patch({ of: undefined, open: p.back }), 50); // панель закрылась — снова карточка заказа
    return { id: row.key };
  },
});
