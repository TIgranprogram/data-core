import { h } from '../core/dom.js';
import { api } from '../core/api.js';

/** Ссылка «на заказчика»: открывает его карточку в «Контрагентах» (все его заказы, суммы). Пусто — прочерк не рисуем. */
export const customerLink = (name) => (name
  ? h('a', { href: '#partners?type=customer&open=' + encodeURIComponent('c:' + name), title: 'Открыть заказчика: все его заказы' }, name)
  : '');

// «Наша компания» в заказе хранится названием; id берём из списка «Наши компании» (один запрос на сессию).
let ours = null;
const ourIds = () => (ours ||= api('/partners', { query: { type: 'our', limit: 100 } })
  .then((r) => new Map((r.items || []).map((p) => [p.name, p.id])))
  .catch(() => { ours = null; return new Map(); }));

/** Ссылка «на нашу компанию»: сразу текст, ссылкой становится, когда найден id. */
export const companyLink = (name) => {
  if (!name) return '';
  const el = h('span', null, name);
  ourIds().then((m) => {
    const id = m.get(name);
    if (id && el.isConnected !== false) el.replaceWith(h('a', { href: '#partners?type=our&open=' + encodeURIComponent(id), title: 'Открыть нашу компанию: реквизиты и бланки' }, name));
  });
  return el;
};
