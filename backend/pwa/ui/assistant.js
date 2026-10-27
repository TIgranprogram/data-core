import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { current } from '../core/router.js';
import { icon } from './icons.js';
import { noteTime } from './design-notes.js';

/**
 * Мини-чат помощника ИИ (этап 1, только чтение). Правая панель, на телефоне — весь экран.
 * Сервер: POST /assistant/chat, GET /assistant/history, GET /assistant/usage.
 */
const TIPS = ['Что горит сегодня?', 'Какие заявки без поставщика?', 'Что с заказом 25?'];
const MODEL_LABEL = { fast: 'Быстро', normal: 'Обычно', smart: 'Сложно' };
const usd = (n) => '$' + (Number(n) || 0).toFixed(2).replace(/\.00$/, '');

/** Текст ответа → блоки: абзацы и простые списки. Только textContent. */
export function replyNodes(text) {
  const out = [];
  let ul = null;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      if (!ul) { ul = h('ul', { class: 'as-list' }); out.push(ul); }
      ul.append(h('li', null, m[1]));
    } else {
      ul = null;
      if (line.trim()) out.push(h('p', { class: 'as-p' }, line.trim()));
    }
  }
  return out;
}

/** Ошибка сервера по-человечески. */
export function errText(e) {
  const s = e?.status || e?.statusCode;
  if (s === 503) return 'Помощник ещё не подключён: администратор добавит ключ. Обратитесь к администратору.';
  if (s === 429) return e?.message || 'На сегодня лимит помощника исчерпан. Попробуйте завтра.';
  if (s === 403) return 'Этот режим доступен только администратору. Выберите «Быстро» или «Обычно».';
  if (s === 502) return 'Помощник сейчас недоступен. Попробуйте через минуту.';
  return e?.message || 'Не удалось получить ответ. Попробуйте ещё раз.';
}

export function assistantButton() {
  const btn = h('button', { type: 'button', class: 'btn btn-ghost as-btn', title: 'Помощник', 'aria-label': 'Помощник', onclick: () => openAssistant() }, icon('info'), h('span', { class: 'as-btn-t' }, 'Помощник'));
  return btn;
}

let opened = null;
export function openAssistant() {
  if (opened) { opened.input?.focus(); return; }
  let usage = null;
  let model = 'normal';
  let busy = false;
  const list = h('div', { class: 'dn-list as-list-box', role: 'log', 'aria-live': 'polite' });
  const counter = h('div', { class: 'muted small as-count' });
  const input = h('textarea', { class: 'dn-input', rows: 2, maxlength: 4000, placeholder: 'Спросите про заявки, склад, заказы…', 'aria-label': 'Вопрос помощнику' });
  const send = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ask(input.value) }, 'Отправить');
  const seg = h('div', { class: 'seg as-seg', role: 'group', 'aria-label': 'Режим' });
  const form = h('div', { class: 'dn-form as-form' }, input, h('div', { class: 'dn-row' }, seg, send));
  const body = h('div', { class: 'drawer-body as-body' }, list);
  const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); drawer.remove(); opened = null; };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) { e.stopPropagation(); close(); } };
  const drawer = h('aside', { class: 'drawer as-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Помощник' },
    h('div', { class: 'drawer-head' }, h('div', { class: 't' }, h('h2', null, 'Помощник'), counter),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Закрыть', 'aria-label': 'Закрыть', onclick: close }, '✕')),
    body, h('div', { class: 'drawer-foot as-foot' }, form));
  const back = h('div', { class: 'drawer-back as-drawer-back', onclick: close });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back, drawer);
  opened = { input };

  const bubble = (role, text, time) => h('div', { class: 'dn-item as-' + role },
    h('div', { class: 'dn-bubble' },
      h('div', { class: 'dn-head' }, h('b', null, role === 'user' ? 'Вы' : 'Помощник'), time ? h('span', { class: 'muted' }, noteTime(time)) : null),
      role === 'user' ? h('div', { class: 'dn-text' }, text) : h('div', { class: 'as-reply' }, ...replyNodes(text))));
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  const paintCount = () => {
    if (!usage) return;
    counter.textContent = `сегодня: ${usd(usage.userUsd)} из ${usd(usage.userLimitUsd)}`;
  };
  const paintSeg = () => {
    const keys = (usage?.models || []).map((m) => m.key).filter((k) => MODEL_LABEL[k]);
    if (!keys.includes(model)) model = keys.includes('normal') ? 'normal' : keys[0] || 'normal';
    seg.replaceChildren(...keys.map((k) => h('button', { type: 'button', class: k === model ? 'active' : '', 'aria-pressed': String(k === model), onclick: () => { model = k; paintSeg(); } }, MODEL_LABEL[k])));
  };
  const tips = () => h('div', { class: 'as-tips' }, h('div', { class: 'db-hint' }, 'Спросите, например:'),
    ...TIPS.map((t) => h('button', { type: 'button', class: 'btn btn-sm as-tip', onclick: () => ask(t) }, t)));

  async function ask(raw) {
    const text = String(raw || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true; input.value = '';
    list.querySelector('.as-tips')?.remove();
    list.append(bubble('user', text, new Date()));
    const wait = h('div', { class: 'dn-item as-wait' }, h('div', { class: 'dn-bubble muted' }, 'Думаю…'));
    list.append(wait); scroll();
    const c = current();
    const context = { section: c.section || 'home', ...(c.params.open ? { id: c.params.open } : {}) };
    try {
      const r = await api('/assistant/chat', { method: 'POST', body: { message: text, model, context } });
      wait.replaceWith(bubble('assistant', r.reply, new Date()));
      if (r.spentToday && usage) { usage.userUsd = r.spentToday.userUsd; usage.userLimitUsd = r.spentToday.userLimitUsd; paintCount(); }
    } catch (e) {
      wait.replaceWith(h('div', { class: 'dn-item as-err' }, h('div', { class: 'dn-bubble dn-open' }, errText(e))));
    } finally { busy = false; send.disabled = false; input.focus(); scroll(); }
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });

  (async () => {
    try { usage = await api('/assistant/usage'); } catch (e) { list.replaceChildren(h('div', { class: 'db-hint' }, errText(e))); form.hidden = true; return; }
    if (!usage.configured) {
      list.replaceChildren(h('div', { class: 'db-hint' }, 'Помощник ещё не подключён: администратор добавит ключ. Обратитесь к администратору.'));
      form.hidden = true; return;
    }
    paintCount(); paintSeg();
    let items = [];
    try { items = (await api('/assistant/history', { query: { limit: 50 } })).items || []; } catch { /* лента пустая */ }
    list.replaceChildren(...items.map((m) => bubble(m.role === 'user' ? 'user' : 'assistant', m.text, m.createdAt)));
    if (!items.length) list.append(tips());
    scroll(); input.focus();
  })();
}
