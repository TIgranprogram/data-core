/**
 * Шаблон «Карточка объекта» (screenCard, DESIGN §3.1; C118 W2). Возвращает section.card для openCard (ui/kit/card.js):
 * порядок блоков сверху вниз задаёт шаблон, экран выбрать его не может:
 *   шапка (сущность, подпись, этап один раз; «⋯» — всё второстепенное)
 *   → warnCard × N (предупреждения, с кнопкой)  → nextCard («Что дальше» + одна главная кнопка)
 *   → infoCard (сведения ≤ 6 строк + «Подробнее»)  → вкладки по смыслу объекта.
 * cfg: { title(r), sub?(r), stage?(r), side?(r) → [справа у заголовка, справа у подписи], warns?(r, ctx) → [{ title, sub?, label?, run? } | узел], next?(r, ctx) → { text, tone?, primary? },
 *        bodyFirst? (true — body(r, ctx, notes) получает блоки предупреждений/«Что дальше» и ставит их сам: таблица первой), facts(r) → пары, more?(r) → пары, menu?(r, ctx) → [{ label, title?, run, danger? }] (все уходят в «⋯»),
 *        tabs?(r, ctx) → [{ key, label, count?, tone?, when?, blocks }], body?(r, ctx) → узел вместо вкладок, before?(r, ctx), noHistory?, parent? }
 */
import { h } from '../../../core/dom.js';
import { stack } from '../index.js';
import { infoCard, nextCard, warnCard } from './blocks.js';

export function screenCard(cfg) {
  const warnEls = (r, ctx) => (cfg.warns?.(r, ctx) || []).filter(Boolean).map((w) => (w instanceof Node ? w
    : warnCard({ tone: w.tone || 'warn', title: w.title, sub: w.sub, actions: w.label ? [{ label: w.label, run: w.run }] : [] })));
  return {
    noHistory: cfg.noHistory,
    parent: cfg.parent,
    actionsInHead: true,
    heading: cfg.title,
    subheading: cfg.side ? (r) => h('div', { class: 'k-head-sub' }, h('span', null, ...[].concat(cfg.sub?.(r) ?? [])), [].concat(cfg.side(r) || [])[1] || null) : cfg.sub,
    // side — справа в шапке (срок): тогда этап встаёт по центру, шапка одним блоком (заказ, 15.11)
    // side(r) → [строка к заголовку, строка к подписи]: справа, каждая на одной линии со своей строкой слева (владелец 15.11)
    headStats: cfg.side ? (r) => h('div', { class: 'k-head-meta' }, cfg.stage ? cfg.stage(r) : h('span'), [].concat(cfg.side(r) || [])[0] || h('span'))
      : cfg.stage ? (r) => h('span', null, cfg.stage(r)) : undefined,
    top: (r, ctx) => {
      cfg.before?.(r, ctx);
      const nx = cfg.next?.(r, ctx);
      const notes = [...warnEls(r, ctx), nx ? nextCard({ text: nx.text, tone: nx.tone, primary: nx.primary }) : null,
        cfg.facts(r).length || cfg.more?.(r)?.length ? infoCard({ facts: cfg.facts(r), more: cfg.more?.(r) || [] }) : null]; // сведений нет — блока нет
      const body = cfg.body?.(r, ctx, cfg.bodyFirst ? notes.filter(Boolean) : undefined) || null; // body — содержимое без вкладок (заказ: таблица позиций, владелец 15.11)
      return cfg.bodyFirst ? body : stack(...notes, body); // bodyFirst: body сам ставит notes (предупреждения, «Что дальше») под таблицей (C131)
    },
    view: () => [],
    actions: (r, ctx) => (cfg.menu?.(r, ctx) || []).filter(Boolean).map((a) => ({ ...a, more: true, primary: false })),
    tabs: cfg.tabs,
  };
}
