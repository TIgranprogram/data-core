import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { getPref, setPref } from '../core/prefs.js';
import { icon } from '../ui/icons.js';
import { toastError } from '../ui/toast.js';
import { noticeTime } from '../ui/notice-card.js';
import { uploadPhoto } from '../ui/photos.js';
import { openZoom } from '../ui/gallery.js';
import { CHAT_REFRESH } from '../ui/chat-button.js';

/**
 * Страница «Чат» (#chat[/<id|all>], параметр with=): слева «Всем» и сотрудники, справа переписка.
 * 390 px: сначала список, тап — переписка с «← Назад» (with= нет и list=1 — список). Последний чат хранится в uiPrefs.lastChat.
 * Отправка: Enter (Shift+Enter — новая строка), фото — Ctrl+V, перетаскивание или скрепка. Опрос — раз в 15 с. Сервер: /messages/*.
 */
const EVERY = 15000;
const narrow = () => window.matchMedia('(max-width: 720px)').matches;
const badge = (n) => (n ? h('span', { class: 'bell-badge static' }, n > 9 ? '9+' : String(n)) : null);
const photoSrc = (p) => PREFIX + (p.thumb || p.url);

function mount(el, { params }) {
  const S = { id: undefined, items: [], all: null, users: null, q: '', pics: [], up: 0, sig: '' };
  const listEl = h('aside', { class: 'cv-list' });
  const convEl = h('section', { class: 'cv-conv' });
  const root = h('div', { class: 'cv' }, listEl, convEl);
  el.append(root);
  let timer = 0;

  const unreadOf = (id) => (id === 'all' ? Number(S.all?.unread) || 0 : Number(S.items.find((t) => t.userId === id)?.unread) || 0);
  const userName = (id) => S.users?.find((u) => u.id === id)?.name || S.items.find((t) => t.userId === id)?.name || 'Сотрудник';

  // ---------- Левый список ----------
  const row = (id, title, sub, last, at, n) => h('button', { type: 'button', class: 'cv-row' + (S.id === id ? ' on' : '') + (n ? ' is-new' : ''), onclick: () => open(id) },
    h('span', { class: 'bt-main' }, h('b', null, title), h('span', { class: 'bt-last' }, last || sub || '')),
    h('span', { class: 'bt-side' }, at ? h('span', { class: 'bt-time' }, noticeTime(at)) : null, badge(n)));
  function paintList() {
    const w = S.q.trim().toLowerCase();
    const byId = new Map(S.items.map((t) => [t.userId, t]));
    const people = (S.users || []).map((u) => ({ u, t: byId.get(u.id) }))
      .filter(({ u }) => !w || String(u.name).toLowerCase().includes(w))
      .sort((a, b) => String(b.t?.lastAt || '').localeCompare(String(a.t?.lastAt || '')) || String(a.u.name).localeCompare(String(b.u.name), 'ru'));
    const all = S.all || {};
    listEl.querySelector('.cv-rows')?.replaceChildren(
      ...(!w || 'всем'.includes(w) ? [row('all', 'Всем', 'Написать всем сотрудникам', all.lastText, all.lastAt, Number(all.unread) || 0)] : []),
      ...(S.users === null ? [h('div', { class: 'bell-empty' }, 'Загружаем…')]
        : people.length ? people.map(({ u, t }) => row(u.id, u.name, u.role || 'Сотрудник', t ? (t.lastFromMe ? 'Вы: ' : '') + (t.lastText || '') : '', t?.lastAt, Number(t?.unread) || 0))
          : [h('div', { class: 'bell-empty' }, w ? 'Никого не нашли.' : 'Других сотрудников пока нет.')]));
  }
  const q = h('input', { type: 'search', class: 'cv-search', placeholder: 'Найти сотрудника…', 'aria-label': 'Найти сотрудника' });
  q.addEventListener('input', () => { S.q = q.value; paintList(); });
  listEl.append(h('div', { class: 'cv-head' }, h('b', null, 'Сообщения')), q, h('div', { class: 'cv-rows' }));

  // ---------- Переписка ----------
  const feed = h('div', { class: 'chat-feed', role: 'log', 'aria-live': 'polite' });
  const title = h('b', { class: 'cv-title' });
  const subt = h('span', { class: 'cv-sub' });
  const back = h('button', { type: 'button', class: 'btn btn-ghost btn-icon cv-back', 'aria-label': 'Назад к списку', onclick: () => go('chat', { list: '1' }, { replace: true }) }, '←');
  const strip = h('div', { class: 'pf-strip cv-pics', hidden: true });
  const text = h('textarea', { class: 'chat-input', rows: 2, maxlength: 2000, placeholder: 'Сообщение…  Enter — отправить, Shift+Enter — новая строка', 'aria-label': 'Сообщение' });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const clip = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', title: 'Добавить фото (можно вставить Ctrl+V или перетащить)', 'aria-label': 'Добавить фото', onclick: () => file.click() }, icon('clip'));
  const send = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit() }, 'Отправить');
  const form = h('div', { class: 'chat-form' }, clip, text, send);
  convEl.append(h('div', { class: 'cv-head' }, back, h('span', { class: 'cv-who' }, title, subt)), feed, strip, form, file);

  const paintPics = () => {
    strip.hidden = !S.pics.length && !S.up;
    strip.replaceChildren(...S.pics.map((p, i) => h('div', { class: 'pf-item' },
      h('img', { src: photoSrc(p), alt: '' }),
      h('button', { type: 'button', class: 'pf-del', title: 'Убрать фото', 'aria-label': 'Убрать фото', onclick: () => { S.pics.splice(i, 1); paintPics(); } }, '×'))),
    ...(S.up ? [h('div', { class: 'pf-item cv-up' }, 'Загружаю…')] : []));
  };
  async function addFiles(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) { toastError(new Error('Это не картинка — нужны JPG, PNG, WEBP')); return; }
    if (S.pics.length + imgs.length > 10) { toastError(new Error('В одном сообщении — не больше 10 фото')); return; }
    S.up += imgs.length; paintPics();
    for (const f of imgs) {
      try { S.pics.push(await uploadPhoto(f)); } catch (e) { toastError(e, 'загрузить фото'); }
      S.up -= 1; paintPics();
    }
  }
  file.addEventListener('change', () => { if (file.files.length) addFiles(file.files); file.value = ''; });
  const dropOn = (node) => {
    node.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('over'); });
    node.addEventListener('dragleave', () => root.classList.remove('over'));
    node.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('over'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  };
  dropOn(feed); dropOn(form);
  const onPaste = (e) => {
    if (!root.isConnected) { document.removeEventListener('paste', onPaste); return; }
    if (!S.id) return;
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // обычный текст вставляется как обычно
    e.preventDefault(); addFiles(files);
  };
  document.addEventListener('paste', onPaste);

  const bubble = (m, isAll) => h('div', { class: 'chat-msg' + (m.mine ? ' mine' : '') },
    isAll && !m.mine ? h('div', { class: 'chat-from' }, m.fromName || 'Сотрудник') : null,
    m.text ? h('div', { class: 'chat-text' }, m.text) : null,
    m.photos?.length ? h('div', { class: 'chat-photos' }, ...m.photos.map((p, i) => h('button', { type: 'button', class: 'chat-photo', title: 'Открыть фото', onclick: () => openZoom(m.photos, i) }, h('img', { src: photoSrc(p), alt: 'Фото', loading: 'lazy', decoding: 'async' })))) : null,
    h('div', { class: 'chat-time' }, noticeTime(m.createdAt) + (m.mine && !isAll && m.readAt ? ' · прочитано' : '')));
  function paintFeed(items, isAll) {
    const list = [...items].reverse(); // сервер отдаёт свежие сверху
    const s = S.id + ':' + list.map((m) => m.id + (m.readAt ? 'r' : '')).join(',');
    if (s === S.sig) return;
    S.sig = s;
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60 || !feed.childElementCount;
    feed.replaceChildren(...(list.length ? list.map((m) => bubble(m, isAll))
      : [h('div', { class: 'chat-empty' }, isAll ? 'Здесь пока тихо. Напишите всем сотрудникам — сообщение увидят все.' : 'Сообщений пока нет. Напишите первым — собеседник увидит его в чате.')]));
    if (stick) feed.scrollTop = feed.scrollHeight;
  }

  async function load() {
    if (!root.isConnected) return;
    const id = S.id;
    try {
      const [t, users] = await Promise.all([api('/messages/threads'), S.users ? null : api('/messages/users')]);
      if (users) S.users = users.items || [];
      S.items = t.items || []; S.all = t.all || null;
      paintList();
      if (!id || id !== S.id) return;
      const res = await api(id === 'all' ? '/messages/all?limit=100' : `/messages/with/${id}?limit=100`);
      if (id !== S.id) return;
      paintFeed(res.items || [], id === 'all');
      if (unreadOf(id)) {
        await api(id === 'all' ? '/messages/all/read' : `/messages/with/${id}/read`, { method: 'POST' });
        if (id === 'all' && S.all) S.all.unread = 0; else { const th = S.items.find((x) => x.userId === id); if (th) th.unread = 0; }
        paintList();
        document.dispatchEvent(new Event(CHAT_REFRESH));
      }
    } catch { /* фон: молча, следующий опрос повторит */ }
  }
  const tick = () => { if (!root.isConnected) return; if (document.visibilityState === 'visible') load(); timer = setTimeout(tick, EVERY); };

  async function submit() {
    const v = text.value.trim();
    if (send.disabled) return;
    if (S.up) { toastError(new Error('Подождите, фото ещё загружается')); return; }
    if (!v && !S.pics.length) { toastError(new Error('Напишите текст или добавьте фото')); return; }
    const body = { ...(S.id === 'all' ? { toAll: true } : { toUserId: S.id }), ...(v ? { text: v } : {}), ...(S.pics.length ? { photoIds: S.pics.map((p) => p.id) } : {}) };
    send.disabled = true; send.classList.add('is-busy');
    try {
      await api('/messages', { method: 'POST', body });
      text.value = ''; S.pics = []; paintPics(); S.sig = ''; await load();
      feed.scrollTop = feed.scrollHeight;
      document.dispatchEvent(new Event(CHAT_REFRESH));
    } catch (e) { toastError(e, 'отправить сообщение'); }
    send.disabled = false; send.classList.remove('is-busy'); text.focus();
  }
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });

  // ---------- Выбор собеседника ----------
  function show(id) {
    if (id === S.id) return;
    S.id = id; S.sig = ''; S.pics = []; paintPics(); text.value = '';
    root.classList.toggle('is-conv', !!id);
    if (id) {
      title.textContent = id === 'all' ? 'Всем' : userName(id);
      subt.textContent = id === 'all' ? 'Сообщение увидят все сотрудники' : (S.users?.find((u) => u.id === id)?.role || '');
      feed.replaceChildren(h('div', { class: 'chat-empty' }, 'Загружаем…'));
      setPref('lastChat', id);
      if (!narrow()) text.focus();
    }
    paintList(); load();
  }
  function open(id) { go('chat', { with: id }, { replace: true }); }

  /** Адрес -> собеседник. Нет with: телефон со списком (list=1) остаётся в списке, иначе открывается последний чат или «Всем». */
  async function route(p) {
    if (p.with) {
      if (p.with !== 'all' && S.users === null) { try { S.users = (await api('/messages/users')).items || []; } catch { S.users = []; } }
      if (p.with !== 'all' && !S.users.some((u) => u.id === p.with)) { open('all'); return; }
      show(p.with); return;
    }
    if (narrow() && p.list) { show(null); return; }
    if (S.users === null) { try { S.users = (await api('/messages/users')).items || []; } catch { S.users = []; } }
    const last = getPref('lastChat');
    open(last && (last === 'all' || S.users.some((u) => u.id === last)) ? last : 'all');
  }

  S.users = null; paintList();
  route(params || {});
  timer = setTimeout(tick, EVERY);
  return { update: (p) => route(p || {}), destroy: () => { clearTimeout(timer); document.removeEventListener('paste', onPaste); } };
}

export const chat = { id: 'chat', title: 'Чат', mount };
