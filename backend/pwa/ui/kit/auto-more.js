import { h } from '../../core/dom.js';
import { failBlock } from './busy.js';
import { mark } from './mark.js';

/**
 * autoMore — подгрузка порциями при прокрутке вниз (эталон ПГ-1c). Один код вместо копий в экранах.
 *
 * autoMore({ load(page, { limit }) → { items, total, … }, render(items, resp), root, limit, skeleton, cls, summary, text, onError })
 *   → { el, reload({ keep }), more(), repaint(), items, total, resp, busy, destroy }
 *   load      — запрос одной порции (page с 1); ответ в контракте { items, total }, прочие поля (sum…) уходят в resp
 *   render    — рисует ВСЕ показанные строки (items — накопленные); вызывается после каждой порции
 *   root      — место списка: на первой порции `.is-busy` (или скелет при skeleton), при сбое первой порции — failBlock «Повторить»
 *   el        — подвал: «Показано N из M» + сентинел + доступная кнопка «Показать ещё»; ставит вызывающий
 *   cls       — класс подвала (по умолчанию pager); summary(shown, total, resp) → узел вместо «Показано N из M»
 *   text      — { fail, moreFail } подписи сбоев; onError(e, append) — например toastError
 *   reload()  — первая порция (смена фильтра/поиска); reload({ keep:true }) — перечитать уже показанные порции (после правки строки)
 *   repaint() — перерисовать без запроса (свёрнуть/развернуть группу)
 * Сбой следующей порции: failBlock в подвале, показанные строки остаются.
 *
 * moreSentinel({ hasMore, onMore, root? }) → { el, native, rewatch, destroy } — наблюдатель за нужной областью прокрутки,
 * когда загрузку ведёт сам экран (kit/list.js).
 */
export function moreSentinel({ hasMore, onMore, root = null, margin = '300px 0px' } = {}) {
  const el = h('div', { class: 'k-more-sentinel', 'aria-hidden': 'true' });
  let destroyed = false; let io = null;
  try {
    if (typeof IntersectionObserver === 'function') io = new IntersectionObserver((es) => { if (!destroyed && es.some((x) => x.isIntersecting) && hasMore()) onMore(); }, { root, rootMargin: margin });
  } catch { /* Наблюдатель недоступен — остаётся кнопка подгрузки. */ }
  io?.observe(el);
  return { el, native: !!io, rewatch() { if (io && !destroyed) { io.unobserve(el); io.observe(el); } }, destroy() { destroyed = true; io?.disconnect(); } };
}

export function autoMore({ load, render, root, limit = 30, skeleton = false, cls = 'pager', summary, text = {}, onError } = {}) {
  const S = { items: [], total: 0, page: 0, resp: null, seq: 0, busy: false, destroyed: false };
  const foot = mark(h('div', { class: cls }), 'autoMore');
  const rest = () => S.items.length < S.total;
  const sen = moreSentinel({ hasMore: () => !S.busy && rest(), onMore: () => run({ append: true }) });

  function paintFoot() {
    if (!S.items.length) { foot.replaceChildren(); return; }
    foot.replaceChildren(
      summary ? summary(S.items.length, S.total, S.resp) : h('span', { class: 'muted' }, `Показано ${S.items.length} из ${S.total}`),
      sen.el,
      rest() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run({ append: true }) }, 'Показать ещё') : null);
  }

  async function run({ append = false, keep = false } = {}) {
    if (S.destroyed || (append && (S.busy || !rest() || !S.page))) return;
    const my = ++S.seq;
    const want = keep ? Math.max(S.page, 1) : 1;
    if (append) { S.busy = true; foot.replaceChildren(h('span', { class: 'muted' }, 'Загрузка…')); }
    else {
      S.busy = true;
      if (skeleton) root?.replaceChildren(h('div', { class: 'skel' }));
      else root?.classList.add('is-busy');
    }
    try {
      let resp, items, got;
      if (append) {
        got = S.page + 1;
        resp = await load(got, { limit });
        if (my !== S.seq) return;
        items = [...S.items, ...(resp.items || [])];
      } else {
        resp = await load(1, { limit }); got = 1;
        if (my !== S.seq) return;
        items = resp.items || [];
        while (got < want && items.length < (resp.total ?? items.length)) {
          const r = await load(got + 1, { limit });
          if (my !== S.seq) return;
          items = [...items, ...(r.items || [])]; got++;
        }
        if (my !== S.seq) return;
      }
      S.page = got; S.items = items; S.total = Number(resp.total ?? items.length); S.resp = { ...resp, items };
      render(S.items, S.resp);
      paintFoot();
    } catch (e) {
      if (my !== S.seq) return;
      if (append) foot.replaceChildren(failBlock(e, () => run({ append: true }), { text: text.moreFail || 'Не удалось подгрузить' }));
      else {
        S.items = []; S.total = 0; S.page = 0; S.resp = null;
        root?.replaceChildren(failBlock(e, () => run({ keep }), { text: text.fail || 'Не загрузилось' }));
        foot.replaceChildren();
      }
      onError?.(e, append);
    } finally {
      if (my === S.seq) { S.busy = false; if (!skeleton) root?.classList.remove('is-busy'); sen.rewatch(); }
    }
  }

  return {
    el: foot,
    reload: (opt) => run({ keep: !!opt?.keep }),
    more: () => run({ append: true }),
    repaint: () => { if (S.resp) { render(S.items, S.resp); paintFoot(); sen.rewatch(); } },
    get items() { return S.items; },
    get total() { return S.total; },
    get resp() { return S.resp; },
    get busy() { return S.busy; },
    destroy: () => { S.destroyed = true; S.seq++; sen.destroy(); },
  };
}
