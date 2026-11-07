import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock, busyBlock } from '../ui/kit/busy.js';
import { modal } from '../ui/kit/dialog.js';
import { isoDay, date } from '../core/format.js';
import { patch, go } from '../core/router.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { unmatchedCount } from './matching-queue.js';
import { fillToday } from './fill.js';
import { empty, card, row, button, segmented, section, stack, stat, tabs, link, toolbar, layout, hint, miniChart, tileGrid } from '../ui/kit/index.js';

/**
 * «Сегодня» — утренний бриф по ролям (docs/audit/AUDIT-TODAY.md §3): у каждой роли свои 3–6 блоков,
 * лента дел с действием в один клик, неделя и показатели — свёрнуты. Данные — GET /today?days=7.
 * deps: { open(of, id), refreshCounts() }.
 */
const SNOOZE_KEY = 'dc-today-snooze';
const SEC_OF = { delivery: 'requests', shipment: 'salesorders', design: 'design', work: 'work' };
const KIND_LABEL = { delivery: 'Поставка', shipment: 'Отгрузка', design: 'Проектирование', question: 'Вопрос', payment: 'Оплата', work: 'В работе' };
const SVGNS = 'http://www.w3.org/2000/svg';

// Блоки по ролям, сверху вниз: [ключ, заголовок]. Роль не из списка — «Срочно» + «План».
const DIRECTOR = [['urgent', 'Срочно: просрочено'], ['work', 'В работе'], ['shipment', 'Отгрузки'], ['questions', 'Вопросы проектирования'], ['fill', ''], ['money', 'Деньги']];
const PLAN = {
  user: [['delivery', 'Поставки: ждут приёмки'], ['work', 'Мои задания в работе'], ['shipment', 'Выдать и отгрузить'], ['contracts', 'Договоры поставщиков: истекают']],
  manager: [['urgent', 'Срочно: просрочено'], ['work', 'В работе: просроченные и без исполнителя'], ['questions', 'Вопросы проектирования'], ['shipment', 'Отгрузки'], ['passports', 'Паспорта к выдаче']],
  accountant: [['payment', 'К оплате'], ['fill', ''], ['money', 'Деньги'], ['unmatched', 'Не сопоставлено позиций']],
  director: DIRECTOR,
  admin: DIRECTOR,
};
const DEFAULT_PLAN = [['urgent', 'Срочно'], ['plan', 'План']];
const LISTED = ['delivery', 'work', 'shipment', 'payment']; // блоки-списки: ключ = вид дела в ленте
const EMPTY = {
  delivery: 'Нет поставок, которые ждут приёмки', work: 'Нет заданий со сроком в ближайшие дни — все задания на доске «В работе»', shipment: 'Нет отгрузок на ближайшие дни', payment: 'Нет платежей к оплате',
};

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
  const role = session.role;

  // какие блоки доступны этой роли
  const AVAILABLE = {
    delivery: () => session.sees('requests'), work: () => session.sees('work'), shipment: () => session.sees('salesorders'), payment: () => session.canMoney,
    questions: () => session.sees('design'), passports: () => session.seesDocs(), contracts: () => session.sees('contracts'),
    fill: () => true, // «fill» — не пункт меню: сервер сам отдаёт только группы открытых роли разделов
    money: () => session.canMoney,
  };
  const plan = (PLAN[role] || DEFAULT_PLAN).filter(([k]) => !AVAILABLE[k] || AVAILABLE[k]());
  const has = (k) => plan.some(([key]) => key === k);
  const ownKinds = new Set(plan.map(([k]) => k).filter((k) => LISTED.includes(k)));
  const showWeek = role !== 'user' && role !== 'accountant' && !has('plan');

  let pq = null; // очередь паспортов: строки для блока «Паспорта к выдаче» и счётчики для плитки
  let contractsSoon = [];
  let data = null, showAllQ = false, chip = null, dayFilter = null;
  let mode = null; // «Моё» / «Всё»: первый раз — как скажет сервер (scope.defaultMode)
  let unmatchedN = 0;
  const scopeEl = h('div', { class: 'td-scope', hidden: true });
  const pulseEl = h('div', { class: 'td-pulse' }, busyBlock('Сегодня'));
  const filterEl = h('div');
  const blocksEl = layout.cols(busyBlock('Сегодня'));
  const weekEl = h('div');
  const tilesEl = h('div', { class: 'td-tiles', hidden: true });
  const moneyTileSlot = h('div');
  const fill = has('fill') ? fillToday() : null;

  // ---------- Действия ----------
  const openRec = (c) => {
    if (c.kind === 'payment') { go('money', { tab: 'debts' }); return; }
    if (c.kind === 'work') { go('work', { open: c.id }); return; }
    deps.open(SEC_OF[c.kind], c.id);
  };
  const dropCard = (c) => {
    if (!data) return;
    data.feed = data.feed.filter((x) => !(x.kind === c.kind && x.id === c.id));
    data.feedTotal = Math.max(0, (data.feedTotal || 0) - 1);
    paintFeed();
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
    const { STAGE } = await import('./salesorders.js');
    toast(`${c.title} → ${STAGE.shipped.label}`, { undo: async () => {
      await api(`/salesorders/${c.id}`, { method: 'PATCH', body: { stage: was.stage, shipDate: was.shipDate ? String(was.shipDate).slice(0, 10) : null } });
      load(true);
    } });
    return true;
  }
  async function receive(c) {
    const r = await api(`/supply/requests/${c.id}`);
    const { receiveDialog } = await import('./requests.js');
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

  // ---------- Лента: карточки и списки ----------
  const dueText = (c) => {
    if (c.overdueDays > 0) return `просрочено ${c.overdueDays} ${plural(c.overdueDays, 'день', 'дня', 'дней')}`;
    if (c.daysLeft === 0 || (c.due && c.due === isoDay())) return 'сегодня';
    if (c.daysLeft > 0) return `ещё ${c.daysLeft} ${plural(c.daysLeft, 'день', 'дня', 'дней')}`;
    return '';
  };
  function cardEl(c) {
    let li = null;
    const btns = (c.actions || []).slice(0, 1).map((a) => button({
      label: a.label, kind: 'primary', size: 'S',
      onClick: async (e) => {
        e.stopPropagation();
        const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
        try {
          const ok = await (RUN[a.id] || RUN.open)(c);
          if (ok) { li.classList.add('leaving'); setTimeout(() => done(c), 180); }
        } catch (ex) { toastError(ex); } finally { b.disabled = false; b.classList.remove('is-busy'); }
      },
    }));
    li = row({ cls: 'k-feed', tone: c.tone || 'info', title: c.title, meta: [KIND_LABEL[c.kind], c.sub].filter(Boolean).join(' · '),
      side: h('span', { class: 'muted small nowrap' }, dueText(c)),
      action: [btns, button({ label: 'На завтра', kind: 'ghost', size: 'S', title: 'Спрятать карточку до завтра', onClick: (e) => { e.stopPropagation(); snooze(c); } })] });
    li.tabIndex = 0;
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
    && (chip === 'workover' ? c.kind === 'work' && c.overdueDays > 0 : chip === 'overdue' ? c.overdueDays > 0 : true));
  const questions = () => (data?.feed || []).filter((c) => c.kind === 'question' && notSnoozed(c));
  const expanded = new Set();
  const PREVIEW = 5;
  /** Карточки списка + кнопка «ещё N» (первые PREVIEW). */
  function rowsOf(key, items) {
    const full = expanded.has(key), rows = full ? items : items.slice(0, PREVIEW);
    return [...rows.map(cardEl),
      items.length > PREVIEW ? h('div', null,
        button({ label: full ? 'Свернуть ↑' : `ещё ${items.length - PREVIEW} ↓`, kind: 'ghost', size: 'S',
        onClick: () => { full ? expanded.delete(key) : expanded.add(key); paintFeed(); } })) : null];
  }
  function group(key, title, items, open) {
    if (!items.length) return null;
    return section({ title, count: items.length, open, body: rowsOf(key, items) });
  }
  const unmatchedRow = () => (unmatchedN > 0 ? h('div', null, link({ label: 'Не сопоставлено позиций: ' + unmatchedN, href: '#salesorders', onClick: (e) => { e.preventDefault(); go('salesorders', {}); } })) : null);
  const emptyBox = (t, s2) => empty({ title: t, hint: s2 });
  const emptyLine = (t) => empty({ kind: 'noData', title: t });

  // ---------- Блоки ----------
  /** Каркас блока: section fixed (рамка с заголовком и числом) и телом. */
  function shell(key, title) {
    const el = section({ fixed: true, title, count: '', body: [] });
    el.dataset.b = key;
    const head = el.querySelector('.k-sec-fhead');
    const nEl = head.querySelector('.k-sec-n');
    const body = el.querySelector('.k-sec-body');
    const set = (n, ...kids) => { if (n) { nEl.textContent = String(n); nEl.hidden = false; } else nEl.hidden = true; body.replaceChildren(...kids); return n; };
    return { el, set, head, body };
  }
  const BLOCK = {
    list(key, title) { // delivery / work / shipment / payment
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = visibleFeed().filter((c) => c.kind === key);
        if (key === 'work') items.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0) || (a.personId ? 1 : 0) - (b.personId ? 1 : 0));
        return s.set(items.length, items.length ? stack(...rowsOf(key, items)) : emptyLine(EMPTY[key]));
      } };
    },
    urgent(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const over = visibleFeed().filter((c) => c.overdueDays > 0 && !ownKinds.has(c.kind));
        const um = unmatchedRow();
        s.el.classList.toggle('urgent', over.length > 0); // красный только при просроченных делах; «не сопоставлено» — не тревога
        return s.set(over.length, over.length || um ? stack(...rowsOf('over', over), um) : emptyLine('Нет просроченных дел')) + (um ? 1 : 0);
      } };
    },
    plan(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const all = visibleFeed(), t = isoDay();
        const over = all.filter((c) => c.overdueDays > 0);
        const today = all.filter((c) => !(c.overdueDays > 0) && (c.daysLeft === 0 || c.due === t));
        const week = all.filter((c) => !over.includes(c) && !today.includes(c));
        const rows = [group('today', 'Сегодня', today, true), group('week', 'На неделе', week, true)];
        return s.set(today.length + week.length, rows[0] || rows[1] ? stack(...rows) : emptyLine('Нет дел на сегодня и неделю'));
      } };
    },
    questions(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const qs = questions();
        const rows = showAllQ ? qs : qs.slice(0, 2);
        return s.set(qs.length, qs.length ? stack(
          ...rows.map((c) => row({ title: c.title, meta: c.sub,
            action: button({ label: 'Ответить', kind: 'primary', size: 'S', onClick: () => answer(c) }) })),
          qs.length > 2 ? button({ label: showAllQ ? 'Свернуть ↑' : `Показать все ${qs.length} ↓`, kind: 'ghost', size: 'S', onClick: () => { showAllQ = !showAllQ; paintFeed(); } }) : null) : emptyLine('Нет вопросов без ответа'));
      } };
    },
    passports(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = (pq?.items || []).slice(0, 5);
        const left = Math.max(0, (pq?.total ?? items.length) - items.length);
        return s.set(items.length, items.length ? stack(
          ...items.map((r) => row({ tag: 'button', tone: r.hot ? 'danger' : 'neutral',
            title: `№ ${r.productionNo || r.orderNo || '—'} · ${r.productName || r.title || ''}`,
            meta: [r.customer, r.shipDate ? 'отгрузка ' + date(r.shipDate) : 'без срока', r.passportId ? 'есть черновик' : 'нет паспорта'].filter(Boolean).join(' · '),
            onClick: () => go('docs') })),
          left ? link({ label: `Все (ещё ${left}) →`, href: '#docs', onClick: (e) => { e.preventDefault(); go('docs'); } }) : null) : emptyLine('Нет паспортов, которые пора выдать'));
      } };
    },
    contracts(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = contractsSoon;
        return s.set(items.length, items.length ? stack(
          ...items.slice(0, 5).map((c) => row({ tag: 'button', tone: String(c.validTo).slice(0, 10) < isoDay() ? 'danger' : 'neutral',
            title: `Договор № ${c.no || '—'}`,
            meta: [c.supplierName, (String(c.validTo).slice(0, 10) < isoDay() ? 'истёк ' : 'до ') + date(c.validTo)].filter(Boolean).join(' · '),
            onClick: () => patch({ of: 'contract', open: c.id || c._id }) }))) : emptyLine('Нет договоров, которые скоро истекают'));
      } };
    },
    unmatched(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        return s.set(unmatchedN, unmatchedN ? link({ label: 'Сопоставить позиции договоров: ' + unmatchedN, href: '#salesorders', onClick: (e) => { e.preventDefault(); go('salesorders', {}); } }) : emptyLine('Нет несопоставленных позиций'));
      } };
    },
    money(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: false, paint() { s.set(0, moneyTileSlot.childNodes.length ? moneyTileSlot : emptyLine('Нет данных по деньгам')); return 0; } };
    },
    fill() { return { el: fill.el, counted: false, paint() { return 0; } }; },
  };
  const blocks = plan.map(([key, title]) => {
    const make = LISTED.includes(key) ? BLOCK.list : BLOCK[key];
    return make ? make(key, title) : null;
  }).filter(Boolean);

  function paintFeed() {
    if (!data) return;
    const fl = dayFilter ? `Дела на ${new Date(dayFilter + 'T00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}`
      : chip ? (chip === 'overdue' ? 'Только просроченные' : 'Только просроченные в работе') : '';
    filterEl.replaceChildren(fl ? toolbar(h('span', null, fl),
      button({ label: 'Показать все', size: 'S', onClick: () => { dayFilter = null; chip = null; paintAll(); } })) : '');
    let total = 0;
    for (const b of blocks) { const n = b.paint(); if (b.counted) total += n || 0; }
    if (!total && !has('fill') && !has('money')) {
      blocksEl.replaceChildren(fl ? emptyBox('Ничего не найдено', 'По этому условию дел нет — нажмите «Показать все».') : emptyBox('Всё спокойно', 'Просроченных дел и вопросов нет. Можно заполнить недостающие данные: раздел «Заполнить».'));
    } else blocksEl.replaceChildren(...blocks.map((b) => b.el));
  }
  const paintAll = () => { paintPulse(); paintFeed(); paintWeek(); };

  // ---------- Пульс: числа ----------
  function paintPulse() {
    const showQ = has('questions'), showW = has('work');
    const mk = (key, n, label, title) => { const el = stat({ value: n || 0, label, active: chip === key,
      onClick: () => {
        if (key === 'question') { showAllQ = !showAllQ; paintFeed(); blocks.find((b) => b.el.dataset.b === 'questions')?.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        chip = chip === key ? null : key; dayFilter = null; paintAll();
      } }); el.title = title; return el; };
    const base = (data?.feed || []).filter((c) => c.kind !== 'question' && notSnoozed(c));
    const o = base.filter((c) => c.overdueDays > 0).length, w = base.filter((c) => c.kind === 'work' && c.overdueDays > 0).length, q = questions().length;
    if (!o && !w && !q && !chip) { pulseEl.replaceChildren(hint('Просроченных дел нет')); return; } // три нулевые пилюли вместо одной строки
    pulseEl.replaceChildren(
      mk('overdue', o, plural(o, 'просроченное дело', 'просроченных дела', 'просроченных дел'), 'Показать только просроченные дела'),
      showW ? mk('workover', w, plural(w, 'задание просрочено', 'задания просрочено', 'заданий просрочено'), 'Показать просроченные задания в работе') : null,
      showQ ? mk('question', q, plural(q, 'вопрос ждёт ответа', 'вопроса ждут ответа', 'вопросов ждут ответа'), 'Показать вопросы') : null);
  }

  // ---------- Неделя (свёрнута) ----------
  function paintWeek() {
    const days = data?.week || [];
    if (!days.length) { weekEl.replaceChildren(); return; }
    const today = isoDay();
    const any = days.some((d) => d.events.length);
    const KIND_TONE = { delivery: 'info', shipment: 'ok', design: 'warn', question: 'warn', payment: 'danger', work: 'info' };
    const week = tabs({
      layout: 'days', label: 'Неделя по дням', value: dayFilter ?? undefined,
      items: days.map((d) => {
        const dt = new Date(d.date + 'T00:00');
        return { key: d.date, today: d.date === today, label: String(dt.getDate()),
          sub: dt.toLocaleDateString('ru-RU', { weekday: 'short' }),
          marks: d.events.slice(0, 3).map((e) => KIND_TONE[e.kind] || 'dim') };
      }),
      onChange: (k) => { dayFilter = dayFilter === k ? null : k; chip = null; paintAll(); },
    });
    weekEl.replaceChildren(week.el, any ? null : hint('На неделе событий нет'));
  }

  // ---------- Плитки-показатели: подпись, число, мини-график ----------
  const SEG_TONE = { s1: 'info', s2: 'warn', s3: 'ok', s4: 'dim' };
  const segBar = (parts) => miniChart({ type: 'bar', parts: parts.map((p) => ({ value: p.n, tone: SEG_TONE[p.cls] || 'dim' })) });
  function spark(days) {
    const w = 100, H = 32, pad = 3;
    const vals = days.map((d) => d.balance), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const X = (i) => (i / Math.max(1, days.length - 1)) * w;
    const Y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
    return svg('svg', { viewBox: `0 0 ${w} ${H}`, preserveAspectRatio: 'none', class: 'td-spark', 'aria-hidden': 'true' },
      svg('line', { x1: 0, x2: w, y1: Y(0), y2: Y(0), class: 'td-zero', 'vector-effect': 'non-scaling-stroke' }),
      svg('polyline', { points: days.map((d, i) => `${X(i)},${Y(d.balance)}`).join(' '), fill: 'none', class: 'td-line', 'vector-effect': 'non-scaling-stroke' }));
  }
  const tile = (label, value, graph, onclick, title) => {
    const el = card({ size: 'S', title: value, meta: label, badges: graph || miniChart({ type: 'bar', parts: [] }), onClick: onclick });
    el.title = title || '';
    return el;
  };
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
    }
    if (m.work != null && session.sees('work')) out.push(tile('Задания в работе', String(m.work), null, () => go('work'), 'Открыть доску «В работе»'));
    if (pq?.counts?.hot > 0 && !has('passports')) out.unshift(tile('Паспорта к сроку · ' + pq.counts.hot, String(pq.counts.hot), segBar([{ n: pq.counts.none || 0, cls: 's1' }, { n: pq.counts.draft || 0, cls: 's2' }, { n: pq.counts.rework || 0, cls: 's3' }]),
      () => go('docs'), 'Позиции, где проектирование готово, а паспорта нет и до отгрузки не больше 3 дней'));
    const days = m.money?.days;
    moneyTileSlot.replaceChildren();
    if (days?.length && session.canMoney) {
      const last = days[days.length - 1].balance;
      const mt = tile('Деньги, 14 дн.', Math.round(last).toLocaleString('ru-RU') + ' ₽', spark(days), () => go('money'), 'Остаток денег на 14 дней');
      if (has('money')) moneyTileSlot.append(mt); else out.push(mt);
    }
    tilesEl.replaceChildren(...out);
    tilesEl.hidden = !out.length;
    statsFold.hidden = !out.length;
  }

  // ---------- Моё / Всё (ЗО-4) ----------
  function paintScope() {
    const sc = data?.scope;
    scopeEl.hidden = !sc;
    if (!sc) return;
    const pick = (m) => { if (mode === m) return; mode = m; load(); };
    scopeEl.replaceChildren(
      segmented({ items: [{ key: 'mine', label: 'Моё' }, { key: 'all', label: 'Всё' }], value: mode, onChange: (m) => pick(m), label: 'Что показывать' }).el,
      sc.linked === false ? hint('Вход не связан с сотрудником — скажите директору.') : null);
  }

  // ---------- Загрузка ----------
  const soon = () => { const d = new Date(); d.setDate(d.getDate() + 14); return isoDay(d); };
  async function load(silent = false) {
    try {
      const [d, q, ct] = await Promise.all([
        api('/today', { query: { days: 7, ...(mode ? { scope: mode } : {}) } }),
        has('passports') || session.seesDocs() ? api('/passports/queue', { query: { due: 'soon', limit: 5 } }).catch(() => pq) : Promise.resolve(pq),
        has('contracts') ? api('/supply/contracts', { query: { status: 'active', limit: 200 } }).catch(() => null) : Promise.resolve(null),
      ]);
      data = d; pq = q;
      if (ct) contractsSoon = (ct.items || []).filter((c) => c.validTo && String(c.validTo).slice(0, 10) <= soon()).sort((a, b) => String(a.validTo).localeCompare(String(b.validTo)));
      if (!mode) mode = d.scope?.defaultMode === 'mine' ? 'mine' : 'all';
      paintScope();
      fill?.load();
      unmatchedN = (has('urgent') || has('unmatched')) ? (await unmatchedCount()).total || 0 : 0;
      paintTiles(); paintAll();
    } catch (e) {
      if (silent && data) return;
      blocksEl.replaceChildren(failBlock(e, () => load())); pulseEl.replaceChildren();
    }
  }

  // ---------- Быстрые действия (склад и снабжение; на телефоне — крупные плитки) ----------
  const quick = ['user', 'manager'].includes(role) && (seeReq || seeStock);
  const act = (label, title, onclick) => button({ label, title, onClick: onclick });
  const actions = quick ? toolbar(
    seeReq ? [
      act('+ Заявка', 'Новая заявка — форма справа', () => patch({ of: 'requests', new: '1', open: undefined })),
      act('+ Из таблицы', 'Скопировать строки из Excel / сайта — заявки на все позиции', () => patch({ of: 'pasteorder', new: '1', open: undefined })),
      act('+ Счёт', 'Внести счёт, которого не было в заявках', () => patch({ of: 'invoice', new: '1', open: undefined }))] : null,
    null) : null; // УПР-1/Д5: кнопки склада убраны с «Сегодня» — они в «Складе»
  const goTiles = quick ? tileGrid(
    seeReq ? card({ size: 'S', title: '+ Заявка', meta: 'закончилось — что, сколько', onClick: () => patch({ of: 'requests', new: '1', open: undefined }) }) : null,
    seeStock ? card({ size: 'S', title: 'Склад', meta: 'остатки и движения', onClick: () => { location.hash = '#stock'; } }) : null) : null;

  // Диск сервера и целостность данных — только админу и только если есть что показать (под блоками)
  // проверки здоровья — не чаще раза в час (ответ в sessionStorage)
  const hourly = async (path) => {
    const k = 'dc.health.' + path;
    try { const c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < 3600000) return c.v; } catch { /* нет кэша */ }
    const v = await api(path);
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch { /* хранилище недоступно */ }
    return v;
  };
  const diskNote = hint('');
  diskNote.hidden = true;
  if (role === 'admin' || session.user?.isOwner) {
    hourly('/health/disk').then((d) => {
      if (d.level === 'ok') return;
      diskNote.hidden = false;
      diskNote.replaceChildren(h('b', null, `Диск сервера занят на ${String(d.usedPct).replace('.', ',')}%`),
        ` — свободно ${(Math.round((d.freeBytes / 1024 ** 3) * 10) / 10).toLocaleString('ru-RU')} ГБ${d.daysLeft != null ? `, хватит примерно на ${d.daysLeft} дн.` : ''}. `,
        h('a', { href: '../admin/' }, 'Подробнее — «Администрирование → Сервер»'));
    }).catch(() => {});
    hourly('/health/integrity').then((r) => {
      if (!r.issues?.length) return;
      const integrityNote = hint(''); integrityNote.replaceChildren(h('b', null, 'Проверка данных: '), r.issues.map((x) => `${x.title} — ${x.count}`).join('; '), '. Напишите разработчику — исправим по плану.'); diskNote.after(integrityNote);
    }).catch(() => {});
  }

  const fold = (title, body, hidden) => { const el = section({ title, body }); el.hidden = !!hidden; return el; };
  const statsFold = fold('Показатели', tilesEl, true);

  const el = h('div', { class: 'today' },
    h('div', { class: 'page-head td-head' },
      h('div', null, h('h1', null, 'Сегодня'), h('div', { class: 'sub' }, `${hello}${first ? ', ' + first : ''} · ${dayText}`)),
      h('div', { class: 'td-bellwrap' }, scopeEl)),
    goTiles,
    pulseEl,
    actions,
    filterEl,
    blocksEl,
    showWeek ? fold('Неделя по дням', weekEl) : null,
    statsFold,
    diskNote);

  load();
  return { el, reload: () => load(true), update: () => {} };
}
