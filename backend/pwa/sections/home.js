import { api, session } from '../core/api.js';
import { fillToday } from './fill.js';
import { pastItems } from './requests.js';
import { lookups } from './lookups.js';
import { quickOrder } from '../ui/quick-order.js';
import { icon } from '../ui/icons.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { patch, go } from '../core/router.js';
import { status, SUPPLY_STATUS, supplyKey } from '../ui/badges.js';
import { toast, toastError } from '../ui/toast.js';
import { moveLabel } from './movements.js';
import { heading, patchStatus, receiveDialog, requests } from './requests.js';
import { markToday } from './orders.js';
import { STAGE } from './salesorders.js';
import { errText } from '../ui/errors.js';

/**
 * «Сегодня» — рабочий стол менеджера (CANON §2 «Главная»). Не витрина, а список дел:
 * очереди «Заказать», «Ждём поставку», «Ждут решения», «Закончилось на складе».
 * Действие — кнопкой прямо в строке (страница не меняется); клик по строке — карточка справа.
 * deps: { open(of, id) — открыть запись в панели, refreshCounts() — счётчики меню }.
 */
export function mountHome(deps) {
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const first = (session.name || '').split(' ')[0];
  const day = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const monthStart = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  // SK-8b: блоки разделов, снятых с роли, не показываем и не загружаем
  const seeReq = session.sees('requests'), seeStock = session.sees('stock'), seeSo = session.sees('salesorders');
  const seePay = session.canMoney && session.sees('orders');

  const summary = h('div', { class: 'summary' });
  // Быстро заказать — «Категория → Позиция из базы» (TASKS С2.1); категории — из подсказок формы заявки.
  // Подсказки (весь склад + заявки) — только при первом касании поля, не при открытии «Сегодня» (сервер с одним ядром)
  let cats = [];
  const loadQuick = () => Promise.all([
    pastItems(),
    lookups().then((lk) => { cats = (lk.categories || []).map((x) => x.name); }).catch(() => {}),
  ]).then(([x]) => x);
  const quick = session.canEdit && seeReq ? quickOrder({ load: loadQuick, categories: () => cats, done: () => reloadAll() }) : null;
  // Быстрые действия (TASKS С2.2): всё ежедневное — в один клик, туда, где делается
  const act = (label, title, onclick) => h('button', { type: 'button', class: 'btn', title, onclick }, label);
  const actions = session.canEdit && (seeReq || seeStock) ? h('div', { class: 'today-actions' },
    seeReq ? [
      act('+ Заявка', 'Полная форма новой заявки справа', () => patch({ of: 'requests', new: '1', open: undefined })),
      act('+ Из таблицы', 'Скопировать строки из Excel / сайта — заявки на все позиции', () => patch({ of: 'pasteorder', new: '1', open: undefined })),
      act('+ Счёт', 'Внести счёт, которого не было в заявках', () => patch({ of: 'invoice', new: '1', open: undefined }))] : null,
    seeStock ? [
      act('Принять машину', 'Приход по счёту: «Склад» → «Принять»', () => go('ops', { mode: 'in' })),
      act('− Списать', 'Выдача со склада: «Склад» → «Выдать»', () => go('ops', {})),
      act('Бронь по списку', 'Спецификация → бронь на складе', () => go('ops', { mode: 'reserve' }))] : null) : null;

  // ---------- Очереди ----------
  const queues = [];
  function queue({ id, title, hint, path, query, row, actions, empty, link, show = true }) {
    if (!show) return null;
    const list = h('ul', { class: 'q-list' }, h('li', { class: 'q-empty' }, h('span', { class: 'skel', style: { width: '70%' } })));
    const n = h('span', { class: 'q-n' }, '');
    const more = h('button', { class: 'q-more', type: 'button', hidden: true });
    let limit = 8;
    const panel = h('section', { class: 'panel queue', id: 'q-' + id },
      h('header', { class: 'q-head' }, h('div', null, h('h3', null, title, ' ', n), h('div', { class: 'q-hint' }, hint)), h('a', { href: link, class: 'q-link' }, 'Все →')),
      list, more);
    more.onclick = () => { limit += 20; load(); };
    async function load() {
      try {
        const r = await api(path, { query: { ...query, limit } });
        n.textContent = r.total ? qty(r.total) : '';
        panel.classList.toggle('done', !r.total);
        if (!r.items.length) { list.replaceChildren(h('li', { class: 'q-empty' }, empty)); more.hidden = true; return; }
        list.replaceChildren(...r.items.map((x) => {
          const li = h('li', { class: 'q-row', tabindex: '0', onclick: (e) => { if (!e.target.closest('button')) row.open(x); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === li) row.open(x); } },
            h('div', { class: 'q-main' }, h('div', { class: 'q-title', title: row.title(x) }, row.title(x)), h('div', { class: 'q-sub' }, row.sub(x))),
            row.side ? h('div', { class: 'q-side' }, row.side(x)) : null,
            session.canEdit && actions ? h('div', { class: 'q-actions' }, actions(x).filter(Boolean).map((a) => h('button', {
              class: 'btn btn-sm' + (a.primary ? ' btn-primary' : ''), type: 'button', title: a.title,
              onclick: async (e) => {
                const b = e.currentTarget; b.disabled = true;
                try {
                  if (await a.run(x)) { li.classList.add('leaving'); setTimeout(reloadAll, 180); }
                } catch (ex) { toastError(ex); } finally { b.disabled = false; }
              },
            }, a.label))) : null);
          return li;
        }));
        more.hidden = r.total <= r.items.length;
        more.textContent = r.total - r.items.length > 20 ? `Показать ещё 20 из ${qty(r.total - r.items.length)}` : `Показать ещё ${qty(r.total - r.items.length)}`;
      } catch (e) { list.replaceChildren(h('li', { class: 'q-empty' }, 'Не загрузилось: ' + errText(e))); }
    }
    queues.push(load);
    return panel;
  }

  const reqRow = {
    title: (x) => heading(x),
    sub: (x) => [`${qty(x.qty)} ${x.unit || ''}`.trim(), x.supplierName, x.orderLabel, x.requestedBy].filter(Boolean).join(' · '),
    side: (x) => h('span', { class: 'q-date' }, date(x.requestDate)),
    open: (x) => deps.open('requests', x.id),
  };
  /** Сменить статус из очереди + «Отменить» во всплывающем сообщении. */
  const step = (to, label) => async (x) => {
    const was = supplyKey(x);
    await patchStatus(x, to);
    toast(`${heading(x)} → ${label}`, { undo: async () => { await patchStatus({ ...x }, was); reloadAll(); } });
    return true;
  };

  const qOrder = queue({
    id: 'order', show: seeReq, title: 'Нужно заказать', hint: 'Оформите заказ у поставщика и отметьте «Заказано»',
    path: '/supply/requests', query: { status: 'requested', sort: '-requestDate' }, link: '#requests?status=requested',
    row: reqRow, empty: 'Всё заказано 👍',
    actions: () => [{ label: 'Заказано', primary: true, title: 'Статус → «В работе»', run: step('ordered', 'В работе') }],
  });
  const qWait = queue({
    id: 'wait', show: seeReq, title: 'Ждём поставку', hint: 'Заказано, ещё не пришло. Пришло — «Принять» на склад',
    path: '/supply/requests', query: { status: 'ordered,paid', sort: 'requestDate' }, link: '#requests?view=board',
    row: { ...reqRow, side: (x) => status(SUPPLY_STATUS, supplyKey(x)) }, empty: 'Ничего не ждём',
    actions: (x) => [
      supplyKey(x) === 'ordered' && { label: 'Оплачено', title: 'Отметить оплату', run: step('paid', 'Оплачено') },
      { label: 'Принять', primary: true, title: 'Оприходовать на склад', run: async (r) => !!(await receiveDialog(r)) },
    ],
  });
  const qDecide = queue({
    id: 'decide', show: seeReq, title: 'Ждут решения', hint: 'Заявки «Ожидает»: заказывать или отменить',
    path: '/supply/requests', query: { status: 'in_progress', sort: 'requestDate' }, link: '#requests?status=in_progress',
    row: reqRow, empty: 'Нерешённых заявок нет',
    actions: () => [
      { label: 'Отменить', title: 'Статус → «Отменено»', run: step('cancelled', 'Отменено') },
      { label: 'В заказ', primary: true, title: 'Статус → «Заказать»', run: step('requested', 'Заказать') },
    ],
  });
  const qStock = queue({
    id: 'stock', show: seeStock, title: 'Закончилось на складе', hint: 'Нет в наличии или ниже минимума — закажите',
    path: '/stock/items', query: { status: 'none,low', sort: 'free' }, link: '#stock?status=none',
    row: {
      title: (x) => x.name,
      sub: (x) => [x.categoryName, x.minQuantity ? `мин. ${qty(x.minQuantity)} ${x.unit || ''}` : ''].filter(Boolean).join(' · '),
      side: (x) => h('span', { class: 'num ' + (x.quantity <= 0 ? 'neg' : '') }, `${qty(x.quantity)} ${x.unit || ''}`.trim()),
      open: (x) => deps.open('stock', x.id),
    },
    empty: 'Всего хватает',
    actions: (x) => [{ label: 'Заказать', primary: true, title: 'Создать заявку на эту позицию', run: async () => {
      patch({ of: 'requests', new: '1', open: undefined, title: x.name, unit: x.unit || '', categoryName: x.categoryName || '' });
      return false;
    } }],
  });

  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const qDue = queue({
    id: 'due', show: seeSo, title: 'Сроки по заказам', hint: 'Отгрузка просрочена или в ближайшие 7 дней',
    path: '/salesorders', query: { filter: 'active', sort: 'shipDate', dueTo: week }, link: '#salesorders?filter=active',
    row: {
      title: (x) => `Заказ № ${x.orderNo || '—'} · ${x.customer || ''}`,
      sub: (x) => [STAGE[x.stage]?.label, `${x.lineCount} поз.`, x.title].filter(Boolean).join(' · '),
      side: (x) => { const d = x.shipDate || x.productionDeadline || x.deliveryDeadline; return h('span', { class: 'num ' + (d && String(d).slice(0, 10) < isoDay() ? 'neg' : '') }, d ? date(d) : ''); },
      open: (x) => deps.open('salesorders', x.id),
    },
    empty: 'Ближайших сроков нет',
    actions: (x) => (x.stage === 'ready' ? [{ label: 'Отгружен', primary: true, title: 'Заказ отгружен сегодня', run: async () => { await api(`/salesorders/${x.id}`, { method: 'PATCH', body: { stage: 'shipped', shipDate: isoDay() } }); return true; } }] : []),
  });

  const qPay = queue({
    id: 'pay', show: seePay, title: 'Ждём оплату от заказчиков', hint: 'Отгружено, деньги ещё не пришли. Пришли — «Оплачено»',
    path: '/incomes', query: { status: 'awaiting', sort: 'reportDate' }, link: '#orders?status=awaiting',
    row: {
      title: (x) => (x.orderNo ? `Заказ ${x.orderNo} · ` : '') + x.title,
      sub: (x) => [x.customer, x.companyName, x.shipDate ? 'отгружено ' + date(x.shipDate) : ''].filter(Boolean).join(' · '),
      side: (x) => h('span', { class: 'num' }, x.amount ? money(x.amount) : 'нет суммы'),
      open: (x) => deps.open('orders', x.id),
    },
    empty: 'Все отгруженные заказы оплачены',
    actions: () => [{ label: 'Оплачено', primary: true, title: 'Деньги пришли сегодня', run: async (x) => { await markToday(x, 'paidDate'); return true; } }],
  });

  // Лента движений склада
  const feed = h('ul', { class: 'q-list' }, h('li', { class: 'q-empty' }, h('span', { class: 'skel', style: { width: '60%' } })));
  const loadFeed = () => (!seeStock ? null : api('/stock/movements', { query: { limit: 8 } }).then((r) => {
    if (!r.items.length) { feed.replaceChildren(h('li', { class: 'q-empty' }, 'Движений пока нет')); return; }
    feed.replaceChildren(...r.items.map((m) => h('li', { class: 'q-row', tabindex: '0', onclick: () => deps.open('stock', m.materialId) },
      h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, m.materialName), h('div', { class: 'q-sub' }, [moveLabel(m), m.note, m.createdBy].filter(Boolean).join(' · '))),
      h('div', { class: 'q-side' }, h('span', { class: 'num ' + (m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : '') }, `${m.delta > 0 ? '+' : ''}${qty(m.delta)} ${m.unit || ''}`.trim()), h('span', { class: 'q-date' }, date(m.date))))));
  }).catch((e) => feed.replaceChildren(h('li', { class: 'q-empty' }, 'Не загрузилось: ' + errText(e)))));
  const qFeed = h('section', { class: 'panel queue' }, h('header', { class: 'q-head' }, h('div', null, h('h3', null, 'Последние движения склада'), h('div', { class: 'q-hint' }, 'Приходы, списания, корректировки')), h('a', { href: '#movements', class: 'q-link' }, 'Все →')), feed);

  // Брони на складе (TASKS Б.1): что отложено, под что, кем; открыть — «Операции» → «Бронь по списку»
  const resList = h('ul', { class: 'q-list' }, h('li', { class: 'q-empty' }, h('span', { class: 'skel', style: { width: '50%' } })));
  const loadRes = () => (!seeStock ? null : api('/stock/reservations').then((r) => {
    if (!r.items.length) { resList.replaceChildren(h('li', { class: 'q-empty' }, 'Броней нет. Отложить позиции под заказ — «Бронь по списку»')); return; }
    resList.replaceChildren(...r.items.slice(0, 6).map((g) => h('li', { class: 'q-row', tabindex: '0', onclick: () => go('ops', { mode: 'reserve' }) },
      h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, g.name),
        h('div', { class: 'q-sub' }, [`позиций: ${g.lines.length}`, g.salesOrder ? 'заказ ' + g.salesOrder : '', g.createdBy].filter(Boolean).join(' · '))),
      h('div', { class: 'q-side' }, g.createdAt ? h('span', { class: 'q-date' }, date(g.createdAt)) : null))));
  }).catch((e) => resList.replaceChildren(h('li', { class: 'q-empty' }, 'Не загрузилось: ' + errText(e)))));
  const qRes = h('section', { class: 'panel queue' }, h('header', { class: 'q-head' }, h('div', null, h('h3', null, 'Брони на складе'), h('div', { class: 'q-hint' }, 'Отложено под заказ / изделие — не трогать')), h('a', { href: '#ops?mode=reserve', class: 'q-link' }, 'Все →')), resList);

  // ---------- Сводка (цифры — переход к очереди на этой же странице) ----------
  let summaryRetry = 0;
  async function loadSummary() {
    try {
      const [all, month, stock, inc] = await Promise.all([
        seeReq ? api('/supply/requests', { query: { limit: 1 } }) : {},
        seeReq ? api('/supply/requests', { query: { limit: 1, from: monthStart } }) : null,
        seeStock ? api('/stock/items', { query: { limit: 1 } }) : {},
        seePay ? api('/incomes', { query: { limit: 1 } }).catch(() => null) : null,
      ]);
      const c = all.counts || {}, s = stock.counts || {};
      const item = (label, value, target, tone) => h('button', { type: 'button', class: 'sum-item' + (tone ? ' ' + tone : ''), onclick: () => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
        h('span', { class: 'sum-v' }, value), h('span', { class: 'sum-l' }, label));
      summary.replaceChildren(...[
        seeReq ? item('нужно заказать', qty(c.requested || 0), 'q-order', c.requested ? 'attn' : '') : null,
        seeReq ? item('ждём поставку', qty((c.ordered || 0) + (c.paid || 0)), 'q-wait') : null,
        seeReq ? item('ждут решения', qty(c.in_progress || 0), 'q-decide') : null,
        seeStock ? item('закончилось на складе', qty((s.none || 0) + (s.low || 0)), 'q-stock', s.none || s.low ? 'attn' : '') : null,
        inc && session.canMoney ? item('ждём оплату', qty(inc.counts?.awaiting || 0), 'q-pay', inc.counts?.awaiting ? 'attn' : '') : null,
        !month ? null : session.canMoney ? h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' }, money(month.sum || 0)), h('span', { class: 'sum-l' }, `заявки за месяц · ${qty(month.total)} шт.`))
          : h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' }, qty(month.total)), h('span', { class: 'sum-l' }, 'заявок за месяц'))].filter(Boolean));
    } catch (e) {
      // Разовый сбой (напр. в момент продления входа) — одна повторная попытка
      if (summaryRetry++ < 1) { setTimeout(loadSummary, 1200); return; }
      summary.replaceChildren(h('div', { class: 'sum-item static' }, h('span', { class: 'sum-l' }, 'Сводка не загрузилась: ' + errText(e))));
    }
  }

  // «Требуют заполнения» (TASKS ТЗ.4): чем заняться — группы с числами, клик — сразу к заполнению
  const fill = fillToday();

  // «Требуют заполнения» — самый тяжёлый подсчёт на сервере: после очередей, чтобы не задерживал их
  function reloadAll() {
    const first = [...queues.map((q) => q()), loadFeed(), loadRes()].filter(Boolean);
    deps.refreshCounts?.();
    Promise.allSettled(first).then(() => fill.load());
  }

  const lane = (title, ico, href, linkText, ...kids) => h('section', { class: 'lane' },
    h('div', { class: 'lane-head' }, icon(ico), h('h2', null, title), h('a', { class: 'lane-link', href }, linkText)), ...kids.filter(Boolean));
  // место на диске сервера (TASKS ДИ.2): админу — плашка, только когда занято больше 80%
  const diskNote = h('p', { class: 'hint disk-note', hidden: true });
  if (session.role === 'admin' || session.user?.isOwner) {
    api('/health/disk').then((d) => {
      if (d.level === 'ok') return;
      diskNote.hidden = false;
      diskNote.replaceChildren(h('b', null, `Диск сервера занят на ${String(d.usedPct).replace('.', ',')}%`),
        ` — свободно ${(Math.round((d.freeBytes / 1024 ** 3) * 10) / 10).toLocaleString('ru-RU')} ГБ${d.daysLeft != null ? `, хватит примерно на ${d.daysLeft} дн.` : ''}. `,
        h('a', { href: '../admin/' }, 'Подробнее — «Администрирование → Сервер»'));
    }).catch(() => {});
  }
  const el = h('div', { class: 'today' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Сегодня'), h('div', { class: 'sub' }, `${hello}${first ? ', ' + first : ''} · ${day}`))),
    diskNote,
    // МП.1: на телефоне — три задачи «на ходу» крупно (на компьютере блок скрыт, там — строка действий)
    session.canEdit && (seeReq || seeStock) ? h('div', { class: 'go-tiles' },
      seeReq ? 
      h('button', { type: 'button', class: 'go-tile', onclick: () => { const q = el.querySelector('.quick-panel'); q?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => q?.querySelector('input, select')?.focus(), 400); } },
        h('b', null, '+ Быстрая заявка'), h('span', null, '«закончилось» — категория, позиция, сколько')) : null,
      seeStock ? [h('a', { class: 'go-tile', href: '#ops?mode=in' }, h('b', null, 'Принять машину'), h('span', null, 'открыть счёт и отметить, что пришло')),
        h('a', { class: 'go-tile', href: '#ops' }, h('b', null, 'Выдать со склада'), h('span', null, 'найти позицию, сколько и кому'))] : null) : null,
    actions,
    // По разделам (TASKS В.4): колонка = раздел приложения, крупный заголовок, очереди друг под другом — без пустот.
    h('div', { class: 'lanes' + (seePay ? ' with-money' : '') },
      seeReq ? lane('Снабжение', 'requests', '#requests', 'Все заявки →', quick ? h('div', { class: 'panel quick-panel' }, h('div', { class: 'section-title' }, 'Быстро заказать'), quick) : null, qOrder, qWait, qDecide) : null,
      seeStock ? lane('Склад', 'stock', '#stock', 'Остатки →', qStock, qRes, qFeed) : null,
      h('div', { class: 'lane-stack' },
        lane('Заполнить', 'table', '#fill', 'Все группы →', fill.el),
        seeSo ? lane('Заказы', 'orders', '#salesorders?filter=active', 'Все заказы →', qDue) : null,
        seePay ? lane('Деньги', 'money', session.sees('money') ? '#money' : '#orders', session.sees('money') ? 'Календарь →' : 'Все →', qPay) : null)));

  reloadAll();
  return { el, reload: reloadAll, update: () => {} };
}
