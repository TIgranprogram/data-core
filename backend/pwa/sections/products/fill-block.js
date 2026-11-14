import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { badge, busyBlock, button, failBlock, hint, miniChart, row as kitRow, section, stack } from '../../ui/kit/index.js';
import { openPassportFunnel } from '../passports/funnel/open.js';

/* Блок «Заполнение изделия» (C114 H-UI): «Заполнено N из M», полоса, «Начните с этого» + до 3 следующих, остальное свёрнуто.
 * Очередь считает сервер (GET /showcase/:id/fill-queue); здесь только рисуем и ведём по клику. Только для тех, кто видит «Документацию». */
const TTL = 20000;
const cache = new Map(); // id → { key, at, q }
const keyOf = (r) => `${r.id}:${r.updatedAt || ''}:${r.passports?.total ?? ''}`;
const fresh = (r) => { const c = cache.get(r.id); return c && c.key === keyOf(r) && Date.now() - c.at < TTL ? c.q : null; };

const TARGET = { passport: 'паспорт', techsheet: 'техописание', both: 'паспорт и техописание' };
const FORM_FIELD = { dimensions: 'dimL', weightKg: 'weightKg', installation: 'installation' }; // пункт изделия → поле формы (name=)

/** Сколько пустых пунктов относится к вкладке: 'passport' | 'techsheet' (нет данных — undefined). */
export function gapsFor(r, tab) {
  const q = fresh(r);
  if (!q) return undefined;
  // техописание нуждается и в габаритах, весе, назначении, монтаже — число у вкладки совпадает с «Осталось N» в панели
  const techKey = (i) => /^(material|part|dim|weight|purpose|install)/i.test(i.key);
  const n = q.items.filter((i) => i.target === 'both' || i.target === tab || (tab === 'techsheet' && techKey(i))).length;
  return n || undefined;
}

/** Клик «Заполнить»: пункт паспорта — в воронку на нужное поле; состав — вкладка; габариты, вес, монтаж — правка изделия с подсветкой поля. */
function go(it, r, ctx) {
  if (it.kind !== 'product') { openPassportFunnel({ productId: r.id, gap: { kind: it.kind, key: it.key, label: it.label } }); return; }
  if (it.key === 'composition') { ctx?.openTab?.('comp'); return; }
  patch({ of: 'products', open: r.id, fill: FORM_FIELD[it.key] || it.key, new: undefined });
}

function itemRow(it, r, ctx, main) {
  return kitRow({
    title: it.label, meta: it.opens || null, wrap: true,
    side: badge(TARGET[it.target] || 'паспорт', 'dim'),
    action: button({ label: 'Заполнить', kind: main ? 'primary' : 'ghost', size: 'S', title: `Заполнить: ${it.label}`, onClick: () => go(it, r, ctx) }),
  });
}

function paint(q, r, ctx) {
  const { done, total, items } = q;
  const reqLeft = items.filter((i) => i.required).length;
  if (!items.length) return [hint('Готово к паспорту и техописанию', 'ok')];
  const head = kitRow({ title: `Заполнено ${done} из ${total}`, side: reqLeft ? badge('есть обязательное', 'warn') : badge('можно выпускать', 'ok') });
  const bar = miniChart({ type: 'bar', parts: [{ value: done, tone: 'ok' }, { value: Math.max(0, total - done), tone: 'dim' }] });
  const [first, ...rest] = items;
  const next = rest.slice(0, 3);
  const more = rest.slice(3);
  return [
    head, bar,
    hint('Начните с этого'),
    itemRow(first, r, ctx, true),
    ...next.map((it) => itemRow(it, r, ctx, false)),
    more.length ? section({ title: `Ещё ${more.length}`, plain: true, body: more.map((it) => itemRow(it, r, ctx, false)) }) : null,
    q.scope === 'passport' ? hint('Посчитано по паспорту; техописание проверяется отдельно.') : null,
  ].filter(Boolean);
}

/** Блок над вкладками панели изделия. Пока грузится — «Загружаю…»; ошибка — карточка с «Повторить». */
export function fillBlock(r, ctx) {
  if (!r?.id || !session.seesDocs()) return null;
  const body = h('div', null);
  const sec = section({ title: 'Заполнение изделия', tone: 'info', open: true, body: [body] });
  const show = (q) => body.replaceChildren(...paint(q, r, ctx));
  const load = async () => {
    body.replaceChildren(busyBlock('очередь заполнения'));
    try {
      const q = await api(`/showcase/${r.id}/fill-queue`);
      const first = !fresh(r);
      cache.set(r.id, { key: keyOf(r), at: Date.now(), q });
      show(q);
      if (first) ctx?.setRow?.(r); // числа у вкладок «Паспорт» / «Техописание»: перерисовка из кэша, без второго запроса
    } catch (e) { body.replaceChildren(failBlock(e, load, { text: 'Очередь заполнения не загрузилась' })); }
  };
  const q = fresh(r);
  if (q) show(q); else load();
  return stack(sec);
}
