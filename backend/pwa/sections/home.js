import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { modal } from '../ui/dialog.js';
import { isoDay, date } from '../core/format.js';
import { patch, go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';
import { unmatchedCount } from './matching-queue.js';
import { fillToday } from './fill.js';

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
  const pulseEl = h('div', { class: 'td-pulse' }, h('span', { class: 'skel', style: { width: '200px' } }));
  const filterEl = h('div', { class: 'td-filterwrap' });
  const blocksEl = h('div', { class: 'td-cols' }, h('div', { class: 'td-card skel-card' }, h('span', { class: 'skel', style: { width: '70%' } })));
  const weekEl = h('div', { class: 'td-week' });
  const tilesEl = h('div', { class: 'td-tiles', hidden: true });
  const moneyTileSlot = h('div', { class: 'td-money' });
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
    && (chip === 'workover' ? c.kind === 'work' && c.overdueDays > 0 : chip === 'overdue' ? c.overdueDays > 0 : true));
  const questions = () => (data?.feed || []).filter((c) => c.kind === 'question' && notSnoozed(c));
  const expanded = new Set();
  const PREVIEW = 5;
  /** Карточки списка + кнопка «ещё N» (первые PREVIEW). */
  function rowsOf(key, items) {
    const full = expanded.has(key), rows = full ? items : items.slice(0, PREVIEW);
    return [...rows.map(cardEl),
      items.length > PREVIEW ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm td-more', onclick: () => { full ? expanded.delete(key) : expanded.add(key); paintFeed(); } },
        full ? 'Свернуть ↑' : `ещё ${items.length - PREVIEW} ↓`) : null];
  }
  function group(key, title, items, open) {
    if (!items.length) return null;
    return h('details', { class: 'td-group', open }, h('summary', null, h('span', null, title), h('b', { class: 'td-gn' }, String(items.length))),
      h('div', { class: 'td-rows' }, ...rowsOf(key, items)));
  }
  const unmatchedRow = () => (unmatchedN > 0 ? h('div', { class: 'td-unm' }, h('a', { href: '#salesorders', onclick: (e) => { e.preventDefault(); go('salesorders', {}); } }, 'Не сопоставлено позиций: ' + unmatchedN)) : null);
  const emptyBox = (t, s2) => h('div', { class: 'td-empty' }, h('b', null, t), s2 ? h('span', null, s2) : null);
  const emptyLine = (t) => h('div', { class: 'td-none' }, t);

  // ---------- Блоки ----------
  /** Каркас блока: рамка с заголовком (и числом) и телом. */
  function shell(key, title) {
    const head = h('h2', { class: 'td-ph' });
    const body = h('div', { class: 'td-pb td-pb-r' });
    const el = h('section', { class: 'td-panel td-b-' + key }, head, body);
    const set = (n, ...kids) => { head.replaceChildren(title, n ? h('b', { class: 'td-gn' }, String(n)) : null); body.replaceChildren(...kids); return n; };
    return { el, set, head, body };
  }
  const BLOCK = {
    list(key, title) { // delivery / work / shipment / payment
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = visibleFeed().filter((c) => c.kind === key);
        if (key === 'work') items.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0) || (a.personId ? 1 : 0) - (b.personId ? 1 : 0));
        return s.set(items.length, items.length ? h('div', { class: 'td-feed' }, ...rowsOf(key, items)) : emptyLine(EMPTY[key]));
      } };
    },
    urgent(key, title) {
      const s = shell(key, title);
      s.el.classList.add('td-urgent');
      return { el: s.el, counted: true, paint() {
        const over = visibleFeed().filter((c) => c.overdueDays > 0 && !ownKinds.has(c.kind));
        const um = unmatchedRow();
        return s.set(over.length, over.length || um ? h('div', { class: 'td-feed' }, ...rowsOf('over', over), um) : emptyLine('Нет просроченных дел')) + (um ? 1 : 0);
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
        return s.set(today.length + week.length, rows[0] || rows[1] ? h('div', { class: 'td-feed' }, ...rows) : emptyLine('Нет дел на сегодня и неделю'));
      } };
    },
    questions(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const qs = questions();
        const rows = showAllQ ? qs : qs.slice(0, 2);
        return s.set(qs.length, qs.length ? h('div', { class: 'td-qcard' },
          ...rows.map((c) => h('div', { class: 'td-q' }, h('div', { class: 'td-q-t' }, c.title), c.sub ? h('div', { class: 'td-sub' }, c.sub) : null,
            h('button', { type: 'button', class: 'btn btn-sm btn-primary td-btn', onclick: () => answer(c) }, 'Ответить'))),
          qs.length > 2 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm td-btn', onclick: () => { showAllQ = !showAllQ; paintFeed(); } },
            showAllQ ? 'Свернуть ↑' : `Показать все ${qs.length} ↓`) : null) : emptyLine('Нет вопросов без ответа'));
      } };
    },
    passports(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = (pq?.items || []).slice(0, 5);
        const left = Math.max(0, (pq?.total ?? items.length) - items.length);
        return s.set(items.length, items.length ? h('div', { class: 'td-passports' },
          ...items.map((r) => h('button', { type: 'button', class: 'td-pass' + (r.hot ? ' hot' : ''), onclick: () => go('docs') },
            h('span', { class: 'td-title' }, `№ ${r.productionNo || r.orderNo || '—'} · ${r.productName || r.title || ''}`),
            h('span', { class: 'td-sub' }, [r.customer, r.shipDate ? 'отгрузка ' + date(r.shipDate) : 'без срока', r.passportId ? 'есть черновик' : 'нет паспорта'].filter(Boolean).join(' · ')))),
          left ? h('a', { class: 'td-more-link', href: '#docs', onclick: (e) => { e.preventDefault(); go('docs'); } }, `Все (ещё ${left}) →`) : null) : emptyLine('Нет паспортов, которые пора выдать'));
      } };
    },
    contracts(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        const items = contractsSoon;
        return s.set(items.length, items.length ? h('div', { class: 'td-passports' },
          ...items.slice(0, 5).map((c) => h('button', { type: 'button', class: 'td-pass' + (String(c.validTo).slice(0, 10) < isoDay() ? ' hot' : ''), onclick: () => patch({ of: 'contract', open: c.id || c._id }) },
            h('span', { class: 'td-title' }, `Договор № ${c.no || '—'}`),
            h('span', { class: 'td-sub' }, [c.supplierName, (String(c.validTo).slice(0, 10) < isoDay() ? 'истёк ' : 'до ') + date(c.validTo)].filter(Boolean).join(' · '))))) : emptyLine('Нет договоров, которые скоро истекают'));
      } };
    },
    unmatched(key, title) {
      const s = shell(key, title);
      return { el: s.el, counted: true, paint() {
        return s.set(unmatchedN, unmatchedN ? h('div', { class: 'td-unm' }, h('a', { href: '#salesorders', onclick: (e) => { e.preventDefault(); go('salesorders', {}); } }, 'Сопоставить позиции договоров: ' + unmatchedN)) : emptyLine('Нет несопоставленных позиций'));
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
    filterEl.replaceChildren(fl ? h('div', { class: 'td-filter' }, fl,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { dayFilter = null; chip = null; paintAll(); } }, 'Показать все')) : '');
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
    const mk = (key, n, label, title) => h('button', { type: 'button', title, class: 'td-chip' + (chip === key ? ' on' : '') + (n ? '' : ' zero'), 'aria-pressed': String(chip === key),
      onclick: () => {
        if (key === 'question') { showAllQ = !showAllQ; paintFeed(); blocks.find((b) => b.el.classList.contains('td-b-questions'))?.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        chip = chip === key ? null : key; dayFilter = null; paintAll();
      } },
      h('b', null, String(n || 0)), h('span', null, label));
    const base = (data?.feed || []).filter((c) => c.kind !== 'question' && notSnoozed(c));
    const o = base.filter((c) => c.overdueDays > 0).length, w = base.filter((c) => c.kind === 'work' && c.overdueDays > 0).length, q = questions().length;
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
    weekEl.replaceChildren(h('div', { class: 'td-days' }, ...days.map((d) => {
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
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Что показывать' },
        ...[['mine', 'Моё'], ['all', 'Всё']].map(([m, label]) => h('button', { type: 'button', class: mode === m ? 'active' : '', 'aria-pressed': String(mode === m), onclick: () => pick(m) }, label))),
      sc.linked === false ? h('div', { class: 'hint td-scope-hint' }, 'Вход не связан с сотрудником — скажите директору.') : null);
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
  const act = (label, title, onclick) => h('button', { type: 'button', class: 'btn', title, onclick }, label);
  const actions = quick ? h('div', { class: 'today-actions' },
    seeReq ? [
      act('+ Заявка', 'Новая заявка — форма справа', () => patch({ of: 'requests', new: '1', open: undefined })),
      act('+ Из таблицы', 'Скопировать строки из Excel / сайта — заявки на все позиции', () => patch({ of: 'pasteorder', new: '1', open: undefined })),
      act('+ Счёт', 'Внести счёт, которого не было в заявках', () => patch({ of: 'invoice', new: '1', open: undefined }))] : null,
    null) : null; // УПР-1/Д5: кнопки склада убраны с «Сегодня» — они в «Складе»
  const goTiles = quick ? h('div', { class: 'go-tiles' },
    seeReq ? h('button', { type: 'button', class: 'go-tile', onclick: () => patch({ of: 'requests', new: '1', open: undefined }) },
      h('b', null, '+ Заявка'), h('span', null, 'закончилось — что, сколько')) : null,
    seeStock ? h('a', { class: 'go-tile', href: '#stock' }, h('b', null, 'Склад'), h('span', null, 'остатки и движения')) : null) : null;

  // Диск сервера и целостность данных — только админу и только если есть что показать (под блоками)
  // проверки здоровья — не чаще раза в час (ответ в sessionStorage)
  const hourly = async (path) => {
    const k = 'dc.health.' + path;
    try { const c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < 3600000) return c.v; } catch { /* нет кэша */ }
    const v = await api(path);
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch { /* хранилище недоступно */ }
    return v;
  };
  const diskNote = h('p', { class: 'hint disk-note', hidden: true });
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
      diskNote.after(h('p', { class: 'hint disk-note' }, h('b', null, 'Проверка данных: '), r.issues.map((x) => `${x.title} — ${x.count}`).join('; '), '. Напишите разработчику — исправим по плану.'));
    }).catch(() => {});
  }

  const fold = (cls, title, body, hidden) => h('details', { class: 'td-weekfold ' + cls, hidden }, h('summary', null, title), h('div', { class: 'td-fold-body' }, body));
  const statsFold = fold('td-stats', 'Показатели', tilesEl, true);

  const el = h('div', { class: 'today' },
    h('div', { class: 'page-head td-head' },
      h('div', null, h('h1', null, 'Сегодня'), h('div', { class: 'sub' }, `${hello}${first ? ', ' + first : ''} · ${dayText}`)),
      h('div', { class: 'td-bellwrap' }, scopeEl)),
    goTiles,
    pulseEl,
    actions,
    filterEl,
    blocksEl,
    showWeek ? fold('td-wk', 'Неделя по дням', weekEl) : null,
    statsFold,
    diskNote);

  load();
  return { el, reload: () => load(true), update: () => {} };
}
