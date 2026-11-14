/**
 * Шаблон «Карточка объекта» (screenCard, DESIGN §3.1; C118 W2). Возвращает section.card для openCard (ui/kit/card.js):
 * порядок блоков сверху вниз задаёт шаблон, экран выбрать его не может:
 *   шапка (сущность, подпись, этап один раз; «⋯» — всё второстепенное)
 *   → warnCard × N (предупреждения, с кнопкой)  → nextCard («Что дальше» + одна главная кнопка)
 *   → infoCard (сведения ≤ 6 строк + «Подробнее»)  → вкладки по смыслу объекта.
 * cfg: { title(r), sub?(r), stage?(r), warns?(r, ctx) → [{ title, sub?, label?, run? } | узел], next?(r, ctx) → { text, tone?, primary? },
 *        facts(r) → пары, more?(r) → пары, menu?(r, ctx) → [{ label, title?, run, danger? }] (все уходят в «⋯»),
 *        tabs?(r, ctx) → [{ key, label, count?, tone?, when?, blocks }], before?(r, ctx), noHistory?, parent? }
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
    subheading: cfg.sub,
    headStats: cfg.stage ? (r) => h('span', null, cfg.stage(r)) : undefined,
    top: (r, ctx) => {
      cfg.before?.(r, ctx);
      const nx = cfg.next?.(r, ctx);
      return stack(...warnEls(r, ctx), nx ? nextCard({ text: nx.text, tone: nx.tone, primary: nx.primary }) : null,
        infoCard({ facts: cfg.facts(r), more: cfg.more?.(r) || [] }));
    },
    view: () => [],
    actions: (r, ctx) => (cfg.menu?.(r, ctx) || []).filter(Boolean).map((a) => ({ ...a, more: true, primary: false })),
    tabs: cfg.tabs,
  };
}
