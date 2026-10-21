/**
 * Шаги истории «Рабочего места» (TASKS НВ.2–НВ.3) — чистая логика без браузера (тесты: nav-stack.test.mjs).
 * Каждая запись истории помечена { dcIdx, kind }: idx — номер шага в этом сеансе, kind — 'card' (открыли карточку
 * переходом) или 'screen'. Стек адресов по шагам нужен для подписи «Назад: Склад» и состояния кнопок.
 *   const nav = createNav(saved)   // saved — из sessionStorage (переживает обновление страницы)
 *   nav.push(url, kind) → state для pushState · nav.replace(url) → state для replaceState · nav.pop(state) — «назад/вперёд»
 *   nav.info() → { idx, canBack, canForward, backUrl, forwardUrl }
 */
export function createNav(saved) {
  let s = saved && Array.isArray(saved.stack) ? { idx: saved.idx | 0, stack: saved.stack.slice() } : { idx: 0, stack: [] };
  const state = (kind) => ({ dcIdx: s.idx, kind: kind || 'screen' });
  return {
    /** Первая запись сеанса (или после обновления страницы: берём шаг из history.state). */
    init(url, histState) {
      if (histState && Number.isInteger(histState.dcIdx) && s.stack[histState.dcIdx] !== undefined) { s.idx = histState.dcIdx; s.stack[s.idx] = url; return { ...histState }; }
      s = { idx: 0, stack: [url] };
      return state('screen');
    },
    /** Новый шаг: всё «впереди» отбрасывается (как в браузере). */
    push(url, kind) { s.idx += 1; s.stack = s.stack.slice(0, s.idx); s.stack[s.idx] = url; return state(kind); },
    replace(url, kind) { s.stack[s.idx] = url; return state(kind); },
    /** «Назад» / «Вперёд» браузера: шаг из state; чужая запись (ссылка-якорь без state) — новый шаг. */
    pop(histState, url) {
      if (histState && Number.isInteger(histState.dcIdx)) { const from = s.idx; s.idx = histState.dcIdx; s.stack[s.idx] = url; return { delta: s.idx - from, adopt: null }; }
      const from = s.idx;
      return { delta: 1, adopt: this.push(url, 'screen'), from };
    },
    info() {
      return { idx: s.idx, canBack: s.idx > 0, canForward: s.idx < s.stack.length - 1, backUrl: s.idx > 0 ? s.stack[s.idx - 1] : null, forwardUrl: s.stack[s.idx + 1] ?? null };
    },
    save() { return { idx: s.idx, stack: s.stack.slice(-200) }; },
  };
}
