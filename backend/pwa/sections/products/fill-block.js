import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { badge, busyBlock, button, failBlock, row as kitRow, section, stack } from '../../ui/kit/index.js';
import { nextCard } from '../../ui/kit/screens/blocks.js';
import { openBookForProduct } from '../passports/open-book.js';

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
  // техописание: число считает сервер тем же расчётом, что «Осталось N» во вкладке (techsheetLeft) — одно число, C114
  if (tab === 'techsheet' && typeof q.techsheetLeft === 'number') return q.techsheetLeft || undefined;
  // C115 QA-B: число у вкладки «Паспорт» = сколько ОБЯЗАТЕЛЬНОГО осталось (как «Осталось N» в воронке)
  const n = q.items.filter((i) => i.required && (i.target === 'both' || i.target === tab)).length;
  return n || undefined;
}

/** Клик «Заполнить»: пункт паспорта — книжка (C141); состав — вкладка; габариты/вес/монтаж — форма изделия. */
function go(it, r, ctx) {
  if (it.kind !== 'product') { openBookForProduct(r.id); return; }
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
  if (!items.length) return [nextCard({ text: 'Изделие заполнено: готово к паспорту и техописанию', tone: 'ok' })];
  const [first, ...rest] = items;
  const reqLeft = items.filter((i) => i.required).length;
  return [
    nextCard({ text: `Заполнено ${done} из ${total}${reqLeft ? ', есть обязательное' : ', можно выпускать'}. Дальше: ${first.label}`, tone: reqLeft ? 'warn' : 'neutral',
      primary: { label: 'Заполнить', title: `Заполнить: ${first.label}`, run: async () => go(first, r, ctx) } }),
    rest.length ? section({ title: `Ещё ${rest.length}`, plain: true, body: rest.map((it) => itemRow(it, r, ctx, false)) }) : null,
    q.scope === 'passport' ? h('p', { class: 'muted small' }, 'Посчитано по паспорту; техописание проверяется отдельно.') : null,
  ].filter(Boolean);
}

/** «Что дальше» изделия (nextCard, C118 W5): первый пустой пункт и главная кнопка «Заполнить». Пока грузится — «Загружаю…»; ошибка — «Повторить». */
export function fillNext(r, ctx) {
  if (!r?.id || !session.seesDocs()) return null;
  const body = stack();
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
  return body;
}
