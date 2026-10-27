import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { icon } from '../ui/icons.js';
import { modal } from '../ui/dialog.js';
import { isoDay } from '../core/format.js';
import { patch, go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';
import { receiveDialog } from './requests.js';
import { STAGE } from './salesorders.js';

/**
 * «Сегодня» — утренний бриф (docs/roles/tz/TODAY.md, этап 1): шапка с пульсом дня и колокольчиком,
 * лента дел с действием в один клик, неделя полосой, диаграммы SVG, быстрые действия.
 * Данные — один запрос GET /today?days=7. deps: { open(of, id), refreshCounts() }.
 */
const SNOOZE_KEY = 'dc-today-snooze';
const SEC_OF = { delivery: 'requests', shipment: 'salesorders', design: 'design' };
const KIND_LABEL = { delivery: 'Поставка', shipment: 'Отгрузка', design: 'Проектирование', question: 'Вопрос', payment: 'Платёж' };
const SVGNS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k) n.append(k);
  return n;
}
const readSnooze = () => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {}; } catch { return {}; } };
const writeSnooze = (m) => { try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* приватный режим — не страшно */ } };
const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; };
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; };

export function mountHome(deps) {
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const first = (session.name || '').split(' ')[0];
  const dayText = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const seeReq = session.sees('requests'), seeStock = session.sees('stock');

  let data = null, showAllQ = false, chip = null, dayFilter = null;
  const pulseEl = h('div', { class: 'td-pulse' }, h('span', { class: 'skel', style: { width: '200px' } }));
  const showQuestions = () => { chip = null; dayFilter = null; showAllQ = true; paintAll(); qEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const bellBtn = h('button', { type: 'button', class: 'td-bell', title: 'Вопросы ждут ответа — показать', 'aria-label': 'Вопросы ждут ответа', hidden: true, onclick: showQuestions });
  const feedEl = h('div', { class: 'td-feed' }, h('div', { class: 'td-card skel-card' }, h('span', { class: 'skel', style: { width: '70%' } })));
  const weekEl = h('div', { class: 'td-week' });
  const qEl = h('section', { class: 'td-qcard', hidden: true });
  const tilesEl = h('div', { class: 'td-tiles', hidden: true });

  // ---------- Действия ----------
  const openRec = (c) => {
    if (c.kind === 'payment') { go(session.sees('money') ? 'money' : 'orders'); return; }
    deps.open(SEC_OF[c.kind], c.id);
  };
  const dropCard = (c) => {
    if (!data) return;
    data.feed = data.feed.filter((x) => !(x.kind === c.kind && x.id === c.id));
    data.feedTotal = Math.max(0, (data.feedTotal || 0) - 1);
    paintFeed(); paintBell();
  };
  const done = (c) => { dropCard(c); deps.refreshCounts?.(); load(true); };

  async function answer(c) {
    let taskId = c.taskId || null;
    if (!taskId) try {
      const r = await api('/design-notes/open-questions');
      const q = (r.items || []).find((x) => String(x.id || x._id) === String(c.id));
      taskId = q && (q.taskId || q.task?.id);
    } catch { /* откроем раздел целиком */ }
    if (taskId) deps.open('design', taskId); else go('design');
  }
  async function moveDate(c) {
    const input = h('input', { type: 'date', value: c.due && c.due > isoDay() ? c.due : isoDay(tomorrow()) });
    const saved = await modal({
      title: 'Перенести дату поставки: ' + c.title,
      body: h('label', { class: 'field' }, h('span', null, 'Новая дата'), input),
      okText: 'Перенести',
      onOk: async () => {
        if (!input.value) throw new Error('Выберите дату');
        await api(`/supply/requests/${c.id}`, { method: 'PATCH', body: { neededBy: input.value } });
        return input.value;
      },
    });
    if (!saved) return false;
    toast('Дата поставки перенесена', { undo: async () => { await api(`/supply/requests/${c.id}`, { method: 'PATCH', body: { neededBy: c.due } }); load(true); } });
    return true;
  }
  async function shipped(c) {
    const was = await api(`/salesorders/${c.id}`);
    await api(`/salesorders/${c.id}`, { method: 'PATCH', body: { stage: 'shipped', shipDate: isoDay() } });
    toast(`${c.title} → ${STAGE.shipped.label}`, { undo: async () => {
      await api(`/salesorders/${c.id}`, { method: 'PATCH', body: { stage: was.stage, shipDate: was.shipDate ? String(was.shipDate).slice(0, 10) : null } });
      load(true);
    } });
    return true;
  }
  async function receive(c) {
    const r = await api(`/supply/requests/${c.id}`);
    return !!(await receiveDialog(r));
  }
  const RUN = { open: async (c) => { openRec(c); return false; }, receive, shipped, move: moveDate, answer: async (c) => { await answer(c); return false; } };

  function snooze(c) {
    const m = readSnooze();
    m[c.kind + ':' + c.id] = isoDay(tomorrow());
    writeSnooze(m);
    dropCard(c);
    toast('Карточка вернётся завтра', { undo: () => { const k = readSnooze(); delete k[c.kind + ':' + c.id]; writeSnooze(k); load(true); } });
  }

  // ---------- Лента: группы ----------
  const dueText = (c) => {
    if (c.overdueDays > 0) return `просрочено ${c.overdueDays} ${plural(c.overdueDays, 'день', 'дня', 'дней')}`;
    if (c.daysLeft === 0 || (c.due && c.due === isoDay())) return 'сегодня';
    if (c.daysLeft > 0) return `ещё ${c.daysLeft} ${plural(c.daysLeft, 'день', 'дня', 'дней')}`;
    return '';
  };
  function cardEl(c) {
    const li = h('article', { class: 'td-card tone-' + (c.tone || 'info'), tabindex: '0' });
    const btns = (c.actions || []).slice(0, 1).map((a) => h('button', {
      type: 'button', class: 'btn btn-sm btn-primary td-btn',
      onclick: async (e) => {
        e.stopPropagation();
        const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
        try {
          const ok = await (RUN[a.id] || RUN.open)(c);
          if (ok) { li.classList.add('leaving'); setTimeout(() => done(c), 180); }
        } catch (ex) { toastError(ex); } finally { b.disabled = false; b.classList.remove('is-busy'); }
      },
    }, a.label));
    li.append(
      h('span', { class: 'td-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'td-main' },
        h('div', { class: 'td-title', title: c.title }, c.title),
        h('div', { class: 'td-sub' }, [KIND_LABEL[c.kind], c.sub].filter(Boolean).join(' · '))),
      h('div', { class: 'td-due' }, dueText(c)),
      h('div', { class: 'td-acts' }, btns, h('button', { type: 'button', class: 'btn btn-ghost btn-sm td-btn td-later', title: 'Спрятать карточку до завтра', onclick: (e) => { e.stopPropagation(); snooze(c); } }, 'На завтра')));
    li.addEventListener('click', (e) => { if (!e.target.closest('button')) openRec(c); });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) openRec(c); });
    // Свайп влево (телефон) — «на завтра»
    let x0 = null;
    li.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    li.addEventListener('touchend', (e) => { if (x0 != null && e.changedTouches[0].clientX - x0 < -90) snooze(c); x0 = null; }, { passive: true });
    return li;
  }
  const notSnoozed = (c) => { const m = readSnooze(); return !(m[c.kind + ':' + c.id] > isoDay()); };
  const visibleFeed = () => (data?.feed || []).filter((c) => c.kind !== 'question' && notSnoozed(c) && (!dayFilter || c.due === dayFilter)
    && (chip === 'shipment' ? c.kind === 'shipment' : chip === 'overdue' ? c.overdueDays > 0 : true));
  const questions = () => (data?.feed || []).filter((c) => c.kind === 'question' && notSnoozed(c));
  function group(title, items, open) {
    if (!items.length) return null;
    return h('details', { class: 'td-group', open }, h('summary', null, h('span', null, title), h('b', { class: 'td-gn' }, String(items.length))),
      h('div', { class: 'td-rows' }, ...items.map(cardEl)));
  }
  function paintFeed() {
    if (!data) return;
    const all = visibleFeed(), t = isoDay();
    const over = all.filter((c) => c.overdueDays > 0);
    const today = all.filter((c) => !(c.overdueDays > 0) && (c.daysLeft === 0 || c.due === t));
    const week = all.filter((c) => !over.includes(c) && !today.includes(c));
    const fl = dayFilter ? `Дела на ${new Date(dayFilter + 'T00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}`
      : chip ? (chip === 'overdue' ? 'Только просроченные' : 'Только отгрузки') : '';
    feedEl.replaceChildren(
      fl ? h('div', { class: 'td-filter' }, fl,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { dayFilter = null; chip = null; paintAll(); } }, 'Показать все')) : null,
      group('Просрочено', over, true), group('Сегодня', today, true), group('На неделе', week, !!dayFilter),
      !all.length ? h('div', { class: 'td-empty' }, h('b', null, fl ? 'Ничего не найдено' : 'Сегодня всё спокойно'),
        h('span', null, 'Срочных дел нет. Можно ', h('a', { href: '#fill' }, 'заполнить недостающие данные'), '.')) : null);
  }
  const paintAll = () => { paintPulse(); paintFeed(); paintQuestions(); paintWeek(); };

  // ---------- Пульс: три числа ----------
  function paintPulse() {
    const p = data?.pulse || {};
    const mk = (key, n, label, title) => h('button', { type: 'button', title, class: 'td-chip' + (chip === key ? ' on' : '') + (n ? '' : ' zero'), 'aria-pressed': String(chip === key),
      onclick: () => { if (key === 'question') { showQuestions(); return; } chip = chip === key ? null : key; dayFilter = null; paintAll(); } },
      h('b', null, String(n || 0)), h('span', null, label));
    const o = p.overdue || 0, s = p.shipmentsSoon || 0, q = p.questions ?? questions().length;
    pulseEl.replaceChildren(
      mk('overdue', o, plural(o, 'просроченное дело', 'просроченных дела', 'просроченных дел'), 'Показать только просроченные дела'),
      mk('shipment', s, plural(s, 'заказ к отгрузке', 'заказа к отгрузке', 'заказов к отгрузке'), 'Показать только отгрузки'),
      mk('question', q, plural(q, 'вопрос ждёт ответа', 'вопроса ждут ответа', 'вопросов ждут ответа'), 'Показать вопросы'));
  }
  function paintBell() {
    const n = data?.pulse?.questions ?? questions().length;
    bellBtn.hidden = !n;
    bellBtn.replaceChildren(icon('bell'), n ? h('span', { class: 'td-bell-n' }, String(n)) : null);
  }

  // ---------- Вопросы: одна карточка ----------
  function paintQuestions() {
    const qs = questions();
    if (!qs.length) { qEl.replaceChildren(); qEl.hidden = true; return; }
    qEl.hidden = false;
    const rows = showAllQ ? qs : qs.slice(0, 2);
    qEl.replaceChildren(
      h('h3', { class: 'td-qh' }, `Вопросы ждут ответа · ${qs.length}`),
      ...rows.map((c) => h('div', { class: 'td-q' }, h('div', { class: 'td-q-t' }, c.title), c.sub ? h('div', { class: 'td-sub' }, c.sub) : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-primary td-btn', onclick: () => answer(c) }, 'Ответить'))),
      qs.length > 2 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm td-btn', onclick: () => { showAllQ = !showAllQ; paintQuestions(); } },
        showAllQ ? 'Свернуть ↑' : `Показать все ${qs.length} ↓`) : null);
  }

  // ---------- Неделя ----------
  function paintWeek() {
    const days = data?.week || [];
    if (!days.length) { weekEl.replaceChildren(); return; }
    const today = isoDay();
    const any = days.some((d) => d.events.length);
    weekEl.replaceChildren(h('h3', { class: 'td-h' }, 'Неделя'), h('div', { class: 'td-days' }, ...days.map((d) => {
      const dt = new Date(d.date + 'T00:00');
      return h('button', {
        type: 'button', class: 'td-day' + (d.date === today ? ' today' : '') + (dayFilter === d.date ? ' on' : ''),
        'aria-pressed': String(dayFilter === d.date),
        onclick: () => { dayFilter = dayFilter === d.date ? null : d.date; chip = null; paintAll(); },
      },
        h('span', { class: 'td-dn' }, dt.toLocaleDateString('ru-RU', { weekday: 'short' })),
        h('b', { class: 'td-dd' }, String(dt.getDate())),
        h('span', { class: 'td-ev' }, d.events.slice(0, 3).map((e) => h('i', { class: 'td-pt k-' + e.kind, title: `${KIND_LABEL[e.kind] || ''}: ${e.title}` })),
          d.events.length > 3 ? h('small', null, '+' + (d.events.length - 3)) : null));
    })), any ? null : h('div', { class: 'td-sub' }, 'На неделе событий нет'));
  }

  // ---------- Плитки-показатели: подпись, число, мини-график ----------
  const segBar = (parts) => {
    const tot = parts.reduce((a, p) => a + p.n, 0);
    return h('div', { class: 'td-seg', 'aria-hidden': 'true' }, tot ? parts.filter((p) => p.n > 0).map((p) => h('i', { class: p.cls, style: { flex: String(p.n) } })) : null);
  };
  function spark(days) {
    const w = 100, H = 32, pad = 3;
    const vals = days.map((d) => d.balance), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const X = (i) => (i / Math.max(1, days.length - 1)) * w;
    const Y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
    return svg('svg', { viewBox: `0 0 ${w} ${H}`, preserveAspectRatio: 'none', class: 'td-spark', 'aria-hidden': 'true' },
      svg('line', { x1: 0, x2: w, y1: Y(0), y2: Y(0), class: 'td-zero', 'vector-effect': 'non-scaling-stroke' }),
      svg('polyline', { points: days.map((d, i) => `${X(i)},${Y(d.balance)}`).join(' '), fill: 'none', class: 'td-line', 'vector-effect': 'non-scaling-stroke' }));
  }
  const tile = (label, value, graph, onclick, title) => h('button', { type: 'button', class: 'td-tile', title, onclick },
    h('span', { class: 'td-tl' }, label), h('b', { class: 'td-tv' }, value), graph || h('div', { class: 'td-seg' }));
  function paintTiles() {
    const m = data?.metrics || {};
    const out = [];
    if (m.supply?.counts) {
      const c = m.supply.counts;
      const n = (c.requested || 0) + (c.in_progress || 0) + (c.ordered || 0);
      out.push(tile('Заявки в пути', String(n), segBar([{ n: c.requested || 0, cls: 's1' }, { n: c.in_progress || 0, cls: 's2' }, { n: c.ordered || 0, cls: 's3' }, { n: c.received || 0, cls: 's4' }]),
        () => go('requests'), 'Запрошено · в работе · заказано · получено'));
    }
    if (m.orders) {
      const b = m.orders.byStage || {};
      out.push(tile('Заказы в работе', String((b.new || 0) + (b.production || 0) + (b.ready || 0)), segBar([{ n: b.new || 0, cls: 's1' }, { n: b.production || 0, cls: 's2' }, { n: b.ready || 0, cls: 's3' }, { n: b.shipped || 0, cls: 's4' }]),
        () => go('salesorders', { filter: 'active' }), 'Новые · в производстве · готовы · отгружены'));
      out.push(tile('Просрочено', String(m.orders.overdue || 0), null, () => { chip = 'overdue'; dayFilter = null; paintAll(); }, 'Просрочено по сроку отгрузки'));
    }
    const days = m.money?.days;
    if (days?.length && session.canMoney) {
      const last = days[days.length - 1].balance;
      out.push(tile('Деньги, 14 дн.', Math.round(last).toLocaleString('ru-RU') + ' ₽', spark(days), () => go('money'), 'Остаток денег на 14 дней'));
    }
    tilesEl.replaceChildren(...out);
    tilesEl.hidden = !out.length;
  }

  // ---------- Загрузка ----------
  async function load(silent = false) {
    try {
      data = await api('/today', { query: { days: 7 } });
      paintBell(); paintTiles(); paintAll();
    } catch (e) {
      if (silent && data) return;
      const fb = failBlock(e, () => load());
      feedEl.replaceChildren(fb); pulseEl.replaceChildren();
    }
  }

  // ---------- Быстрые действия ----------
  const act = (label, title, onclick) => h('button', { type: 'button', class: 'btn', title, onclick }, label);
  const actions = session.canEdit && (seeReq || seeStock) ? h('div', { class: 'today-actions' },
    seeReq ? [
      act('+ Заявка', 'Новая заявка — форма справа', () => patch({ of: 'requests', new: '1', open: undefined })),
      act('+ Из таблицы', 'Скопировать строки из Excel / сайта — заявки на все позиции', () => patch({ of: 'pasteorder', new: '1', open: undefined })),
      act('+ Счёт', 'Внести счёт, которого не было в заявках', () => patch({ of: 'invoice', new: '1', open: undefined }))] : null,
    seeStock ? [
      act('Принять машину', 'Приход по счёту', () => go('ops', { mode: 'in' })),
      h('details', { class: 'td-menu' }, h('summary', { class: 'btn' }, 'Ещё'),
        h('div', { class: 'td-menu-pop' },
          act('− Списать', 'Выдача со склада', () => go('ops', {})),
          act('Бронь по списку', 'Спецификация → бронь на складе', () => go('ops', { mode: 'reserve' }))))] : null) : null;

  // Диск сервера и целостность данных — админу, только если есть что показать
  const diskNote = h('p', { class: 'hint disk-note', hidden: true });
  if (session.role === 'admin' || session.user?.isOwner) {
    api('/health/disk').then((d) => {
      if (d.level === 'ok') return;
      diskNote.hidden = false;
      diskNote.replaceChildren(h('b', null, `Диск сервера занят на ${String(d.usedPct).replace('.', ',')}%`),
        ` — свободно ${(Math.round((d.freeBytes / 1024 ** 3) * 10) / 10).toLocaleString('ru-RU')} ГБ${d.daysLeft != null ? `, хватит примерно на ${d.daysLeft} дн.` : ''}. `,
        h('a', { href: '../admin/' }, 'Подробнее — «Администрирование → Сервер»'));
    }).catch(() => {});
    api('/health/integrity').then((r) => {
      if (!r.issues?.length) return;
      diskNote.after(h('p', { class: 'hint disk-note' }, h('b', null, 'Проверка данных: '), r.issues.map((x) => `${x.title} — ${x.count}`).join('; '), '. Напишите разработчику — исправим по плану.'));
    }).catch(() => {});
  }

  const el = h('div', { class: 'today' },
    h('div', { class: 'page-head td-head' },
      h('div', null, h('h1', null, 'Сегодня'), h('div', { class: 'sub' }, `${hello}${first ? ', ' + first : ''} · ${dayText}`)),
      h('div', { class: 'td-bellwrap' }, bellBtn)),
    diskNote,
    // на телефоне — три задачи «на ходу» крупно
    session.canEdit && (seeReq || seeStock) ? h('div', { class: 'go-tiles' },
      seeReq ? h('button', { type: 'button', class: 'go-tile', onclick: () => patch({ of: 'requests', new: '1', open: undefined }) },
        h('b', null, '+ Заявка'), h('span', null, 'закончилось — что, сколько')) : null,
      seeStock ? [h('a', { class: 'go-tile', href: '#ops?mode=in' }, h('b', null, 'Принять машину'), h('span', null, 'открыть счёт и отметить, что пришло')),
        h('a', { class: 'go-tile', href: '#ops' }, h('b', null, 'Выдать со склада'), h('span', null, 'найти позицию, сколько и кому'))] : null) : null,
    pulseEl,
    actions,
    h('div', { class: 'td-grid' },
      h('section', { class: 'td-panel' }, h('h2', { class: 'td-ph' }, 'Что сделать сегодня'), h('div', { class: 'td-pb' }, qEl, feedEl)),
      h('aside', { class: 'td-panel' }, h('h2', { class: 'td-ph' }, 'Показатели'), h('div', { class: 'td-pb td-pb-r' }, tilesEl, weekEl))));

  load();
  return { el, reload: () => load(true), update: () => {} };
}
