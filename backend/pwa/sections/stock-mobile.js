import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty as fmt } from '../core/format.js';
import { mobile, segmented, errText, toast, catArt } from '../ui/kit/index.js';
import { orderLabel } from './salesorders.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { lookupCode } from './qr.js';
import { loadZones, setZone, zoneNow, zoneQuery } from '../core/zone.js';

/*
 * «Склад (телефон)» — ассистент кладовщика: главный «Выдать» / «Принять» + лента за 7 дней с переключателем «Принято | Выдано».
 * Склад и «Выйти» — в настройках (шестерёнка). Собрана из эталонов kit «mobile» + kit.segmented для ленты.
 * Операции — те же вызовы, что у склада (POST /stock/batch, POST /supply/requests/:id/receive).
 * QR: кнопка «Сканировать QR» (mobile.scan) и вход по ссылке #stock-mobile?q=<код>.
 * Надёжность (DESIGN-MOBILE §2–3): запрос ≤ 15 с, ошибки шагов — с «Повторить», общий перехват ошибок экрана, справочники — кэш на сеанс.
 */
const { screen, bigButton, choice, tiles, feed, dateChoice, qty, textField, drill, done, error, scan, scanSupported } = mobile;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const call = (path, opts = {}) => api(path, { timeout: 15000, ...opts });
const memo = new Map();
/** Справочник один раз за сеанс (ключ учитывает склад); сбой кэш не запоминает. */
const once = (key, load) => { if (!memo.has(key)) memo.set(key, load().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };
const askedKey = () => 'dc-stock-zone-asked-' + (session.user?.id || 'u');
/** Последний получатель выдачи в этой вкладке — чтобы не выбирать заказ снова. */
let lastIssue = null; // { target, where }
/** Режим ленты на главном: in = принятое, out = выданное (за сеанс вкладки). */
let feedKind = 'out';
/** Стандарт в конце названия («…, DIN 603», «ГОСТ 7798-70») — вниз мелко; крупно остаётся название и размер. */
export const splitStd = (name) => { const m = /,?\s*((?:DIN|ГОСТ|ISO|ОСТ|ТУ)\s*[\w.\-–]+)\s*$/i.exec(name || ''); return m ? { name: name.slice(0, m.index).trim(), std: m[1] } : { name: name || '', std: '' }; };
/** Артикул для рабочего: внутренний код «СКЛ-…» не показываем (это не артикул, АР.1). */
const artOf = (it) => (it.article && !/^СКЛ-/i.test(it.article) ? it.article : '');
const dm = (d) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`; };
const unitOf = (it) => it.unit || 'шт';

/** Выбор позиции без клавиатуры: категории плитками (рисунок — из справочника или по названию) → позиции с остатком. */
const itemDrill = (onPick, scanBtn) => drill({ extra: scanBtn, empty: 'Позиций нет',
  levels: [
    { title: '', tiles: true, load: async () => (await once('cats:' + zoneNow(), () => call('/stock/categories', { query: zoneQuery() }))).items.filter((c) => c.id !== 'none')
      .map((c) => ({ value: c.id, label: c.name, art: catArt(c.name) /* только встроенные рисунки: разметку с сервера в страницу не вставляем */ })) },
    { title: '', load: async ([cat]) => ((await call('/stock/items', { query: { ...zoneQuery(), categoryId: cat, limit: 500, sort: 'name' } })).items || [])
      .map((it) => { const n = splitStd(it.name); return { value: it, label: n.name, hint: [`На складе: ${fmt(it.quantity)} ${unitOf(it)}`, n.std, artOf(it)].filter(Boolean).join(' · ') }; }).sort((x, y) => x.label.localeCompare(y.label, 'ru', { numeric: true })) }, // М8×20 раньше М8×100
  ],
  onPick: (o) => onPick(o.value) });

export const stockMobile = {
  title: 'Склад',
  mount(el, { params } = {}) {
    let alive = true;
    const show = (node) => { if (!alive) return; el.replaceChildren(node); window.scrollTo(0, 0); };
    const failMsg = (e) => (!e?.status ? (e?.timeout ? 'Сервер долго отвечает. Повторите.' : 'Нет связи. Ничего не потеряно — повторите, когда появится связь.') : (errText(e) || 'Не получилось. Попробуйте ещё раз.'));
    const failed = (e, retry) => error(failMsg(e), { onRetry: retry });
    const onErr = (ev) => { if (/ResizeObserver/.test(ev?.message || '')) return; show(screen({ body: [error('Что-то пошло не так.', { onRetry: () => home() })] })); };
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);

    /** Считанный код → позиция склада (с остатком) или понятное сообщение. */
    const itemByText = async (text) => {
      const r = await lookupCode(text);
      if (!r.ok) return { fail: r };
      if (r.data.entityType !== 'S') return { fail: { message: 'Этот код не для склада. Наведите на наклейку позиции склада.' } };
      return { item: await call(`/stock/items/${r.data.id}`) };
    };
    /** Кнопка «Сканировать QR» над категориями: камера → позиция → onItem; отмена/сбой — назад к выбору. */
    const scanBtn = (onItem, back) => (scanSupported() ? bigButton({ label: 'Сканировать QR', tone: 'neutral', onClick: () => {
      const s = scan({ onCancel: back, onCode: async (text) => {
        let res;
        try { res = await itemByText(text); } catch (e) { show(screen({ back, body: [failed(e, back)] })); return; }
        if (res.item) onItem(res.item);
        else show(screen({ back, body: [error(res.fail.message)], foot: bigButton({ label: 'Найти вручную', tone: 'neutral', onClick: back }) }));
      } });
      show(screen({ title: 'Наведите на QR-код', back: () => { s.stop(); back(); }, body: [s.el] }));
    } }) : null);

    let zones = [];
    const zoneName = () => zones.find((z) => z.id === zoneNow())?.name || '';
    /** Склад: спрашиваем один раз при первом входе (если доступно несколько); дальше — только в настройках. */
    const pickZone = () => show(screen({ title: 'Какой склад?', back: localStorage.getItem(askedKey()) ? settings : undefined,
      body: [choice({ items: zones.map((z) => ({ value: z.id, label: z.name })), selected: zoneNow(), onPick: (o) => { setZone(o.value); try { localStorage.setItem(askedKey(), '1'); } catch { /* приватный режим */ } home(); } })] }));
    /** В большое приложение (шапка/меню снова видны). Роли только со складом-телефоном — кнопки нет. */
    const toMain = !session.onlyStockMobile
      ? () => { window.location.hash = '#home'; }
      : null;
    const settings = () => show(screen({ title: 'Настройки', back: home, body: [
      toMain ? bigButton({ label: 'Основной', tone: 'neutral', onClick: toMain }) : null,
      zones.length > 1 ? bigButton({ label: `Склад: ${zoneName()} · сменить`, tone: 'neutral', onClick: pickZone }) : null,
      bigButton({ label: 'Выйти', tone: 'neutral', onClick: () => { session.clear(); window.location.reload(); } }),
    ] }));

    // ---------- Главный: «Выдать» / «Принять» + переключатель ленты «Принято | Выдано» за 7 дней ----------
    const feedEmpty = (type) => (type === 'in' ? 'За неделю приёмок нет' : 'За неделю выдач нет');
    /** Движения склада за 7 дней одного типа (in|out); sort=-date — последнее сверху. */
    const loadFeed = async (type) => {
      const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
      const r = await call('/stock/movements', { query: { ...zoneQuery(), from, type, limit: 200, sort: '-date' } });
      return (r.items || []).filter((m) => !m.cancelledAt && !m.cancelOf && m.qty)
        .map((m) => ({ date: dm(m.date), text: m.materialName, qty: fmt(m.qty), unit: m.unit, kind: m.type === 'in' ? 'in' : 'out' }));
    };
    const paintFeed = (box, type) => {
      const empty = feedEmpty(type);
      box.replaceChildren(feed({ loading: true, empty }));
      loadFeed(type).then((items) => { if (alive) box.replaceChildren(feed({ items, empty })); })
        .catch((e) => { if (alive) box.replaceChildren(failed(e, () => paintFeed(box, type))); });
    };
    const home = () => {
      const box = h('div');
      const seg = segmented({
        label: 'Что показать за неделю',
        items: [{ key: 'out', label: 'Выдано' }, { key: 'in', label: 'Принято' }],
        value: feedKind,
        onChange: (k) => { feedKind = k; paintFeed(box, k); },
      });
      paintFeed(box, feedKind);
      show(screen({ title: zoneName() || 'Склад', gear: settings, body: [
        toMain ? bigButton({ label: 'Основной', tone: 'neutral', size: 'sm', onClick: toMain }) : null,
        bigButton({ label: 'Выдать', onClick: () => issue() }),
        bigButton({ label: 'Принять', tone: 'neutral', onClick: () => receive() }),
        seg.el,
        box,
      ] }));
    };

    // ---------- Выдача: кому → позиции в корзину (несколько на одного получателя) → одна операция; после успеха — «ещё на того же» ----------
    function issue(preset) {
      const S = { cart: [], ...(lastIssue ? { target: { ...lastIssue.target }, where: lastIssue.where } : {}) };
      const inCart = (it) => S.cart.filter((c) => c.item.id === it.id).reduce((a, c) => a + c.qty, 0);
      const setTarget = (target, where) => { S.target = target; S.where = where; lastIssue = { target: { ...target }, where }; };
      const afterTarget = () => { if (S.cart.length) stepCart(); else if (preset) { S.item = preset; stepQty(); } else stepItem(); };
      const stepItem = () => {
        const pick = (it) => { S.item = it; stepQty(); };
        const d = itemDrill(pick, scanBtn(pick, stepItem));
        show(screen({ title: 'Что выдаём?', step: { n: 2, of: 3 }, back: () => { if (!d.up()) (S.cart.length ? stepCart() : stepKind()); },
          body: [S.where ? h('p', { class: 'm-empty' }, `Получатель: ${S.where}. Можно несколько позиций подряд.`) : null, d.el] }));
      };
      const stepQty = (note) => {
        const it = S.item;
        const left = it.quantity - inCart(it);
        const q = qty({ value: 1, unit: unitOf(it), max: fmt(left) });
        const msg = h('div');
        if (note) msg.replaceChildren(note);
        const tooMany = (n) => { msg.replaceChildren(error(`На складе только ${fmt(it.quantity)} ${unitOf(it)}${inCart(it) ? `, из них ${fmt(inCart(it))} уже в списке` : ''}.`), bigButton({ label: 'Корректировать остаток', tone: 'neutral', onClick: () => correct(it, (fresh) => { if (fresh?.id) S.item = fresh; stepQty(); }) })); return n; };
        show(screen({ title: it.name, step: { n: 2, of: 3 }, back: stepItem, body: [S.where ? h('p', { class: 'm-empty' }, S.where) : null, q.el, msg], foot: bigButton({ label: 'В список выдачи', onClick: () => {
          const n = q.value();
          if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
          if (n > left) { tooMany(n); return; }
          S.cart.push({ item: it, qty: n }); stepCart();
        } }) }));
      };
      const stepKind = () => {
        const body = [];
        if (lastIssue?.where && !S.cart.length) {
          body.push(bigButton({ label: `Снова: ${lastIssue.where}`, onClick: () => { setTarget({ ...lastIssue.target }, lastIssue.where); afterTarget(); } }));
          body.push(h('p', { class: 'm-empty' }, 'Или выберите другого получателя:'));
        }
        body.push(choice({ items: [{ value: 'order', label: 'На заказ' }, { value: 'person', label: 'На производство' }], onPick: (o) => (o.value === 'order' ? stepOrder() : stepPerson()) }));
        show(screen({ title: 'Кому выдаём?', step: { n: 1, of: 3 }, back: () => (S.cart.length ? stepCart() : home()), body }));
      };
      /** Заказ → позиции. Сверху — в работе; две кнопки: «Готовые к отгрузке» (ready) и «Полностью отгруженные» (shipped). */
      const stepOrder = async () => {
        show(screen({ title: 'Заказ и позиция', step: { n: 1, of: 3 }, back: stepKind, body: [h('div', { class: 'm-empty' }, 'Загружаю…')] }));
        let orders = [];
        let shipped = [];
        try {
          [orders, shipped] = await Promise.all([
            ordersLookup({ filter: 'active', lines: true }),
            ordersLookup({ filter: 'shipped', lines: true }),
          ]);
        } catch (e) { show(screen({ title: 'Заказ и позиция', step: { n: 1, of: 3 }, back: stepKind, body: [failed(e, stepOrder)] })); return; }
        const work = orders.filter((o) => o.stage !== 'ready');
        const ready = orders.filter((o) => o.stage === 'ready');
        const pickOrder = (o, line, lineLabel) => {
          setTarget(line ? { salesOrderLineId: line } : { salesOrderId: o.id }, `на заказ ${orderLabel(o)}${line ? ', поз. ' + lineLabel : ''}`);
          afterTarget();
        };
        /** Нет позиций / одна позиция — меньше нажатий; иначе список, «на весь заказ» сверху. */
        /** Обложка заказа — первое фото среди позиций (lookup уже отдаёт photo). */
        const coverOf = (o) => (o.lines || []).map((l) => l.photo).find((p) => p?.thumb || p?.url) || null;
        const takeOrder = (o, back) => {
          const lines = o.lines || [];
          if (!lines.length) { pickOrder(o, null, ''); return; }
          if (lines.length === 1) {
            const l = lines[0];
            const lab = `1. ${String(l.title || 'Позиция').slice(0, 90)}`;
            show(screen({ title: orderLabel(o), step: { n: 1, of: 3 }, back, body: [
              choice({ items: [
                { value: { line: l.id, lab }, label: lab, hint: 'Единственная позиция заказа', photo: l.photo || null, showPic: true },
                { value: { line: null, lab: '' }, label: 'На весь заказ — без позиции' },
              ], onPick: (it) => pickOrder(o, it.value.line, it.value.lab) })] }));
            return;
          }
          openLines(o, back);
        };
        const linesOf = (o) => {
          const whole = { value: { line: null, o, lab: '' }, label: 'На весь заказ — без позиции', hint: 'Все позиции склада уйдут на заказ целиком' };
          const rows = (o.lines || []).map((l, i) => {
            const lab = `${l.seqNo ?? l.lineNo ?? i + 1}. ${String(l.title || 'Позиция').slice(0, 90)}`;
            return { value: { line: l.id, o, lab }, label: lab, photo: l.photo || null, showPic: true };
          });
          return [whole, ...rows];
        };
        const openLines = (o, back) => show(screen({ title: orderLabel(o), step: { n: 1, of: 3 }, back, body: [
          choice({ items: linesOf(o), empty: 'Позиций нет', onPick: (it) => pickOrder(it.value.o, it.value.line, it.value.lab) })] }));
        const openList = (title, list, empty, hint) => {
          const open = () => show(screen({ title, step: { n: 1, of: 3 }, back: paint, body: [
            hint ? h('p', { class: 'm-empty' }, hint) : null,
            choice({
              items: list.map((o) => ({ value: o, label: orderLabel(o), hint: [o.customer, o.title, (o.lines || []).length ? `${o.lines.length} поз.` : ''].filter(Boolean).join(' · ') || title, photo: coverOf(o), showPic: true })),
              empty,
              onPick: (it) => takeOrder(it.value, open),
            }),
          ] }));
          return open;
        };
        const openReady = openList('Готовые к отгрузке', ready, 'Готовых к отгрузке заказов нет', 'Заказы, которые уже готовы и ждут отгрузки.');
        const openShipped = openList('Полностью отгруженные', shipped, 'Полностью отгруженных заказов нет', 'Отгружено всё — можно довыдать мелочь со склада.');
        const d = drill({ levels: [
          { title: '', load: async () => work.map((o) => ({ value: o.id, label: orderLabel(o), hint: [o.title, (o.lines || []).length ? `${o.lines.length} поз.` : ''].filter(Boolean).join(' · '), photo: coverOf(o), showPic: true })) },
          { title: '', load: async ([id]) => linesOf(orders.find((x) => x.id === id) || {}) },
        ], empty: 'Сейчас нет заказов в работе', onPick: (it) => pickOrder(it.value.o, it.value.line, it.value.lab) });
        const paint = () => show(screen({ title: 'Заказ и позиция', step: { n: 1, of: 3 }, back: () => { if (!d.up()) stepKind(); }, body: [
          d.el,
          h('p', { class: 'm-empty' }, 'Другие стадии — отдельным списком:'),
          bigButton({ label: ready.length ? `Готовые к отгрузке (${ready.length})` : 'Готовые к отгрузке', tone: 'neutral', onClick: openReady }),
          bigButton({ label: shipped.length ? `Полностью отгруженные (${shipped.length})` : 'Полностью отгруженные', tone: 'neutral', onClick: openShipped }),
        ] }));
        paint();
      };
      /** Кому: отдел → сотрудники; без фамилии — выдача в отдел. */
      const stepPerson = async () => {
        show(screen({ title: 'Кому: отдел', step: { n: 1, of: 3 }, back: stepKind, body: [h('div', { class: 'm-empty' }, 'Загружаю…')] }));
        let deps, wts, ppl;
        try {
          [deps, wts, ppl] = await Promise.all(['departments', 'worktypes', 'persons'].map((k) => once('dict:' + k, () => call('/dicts/' + k).then((r) => r.items || []))));
        } catch (e) { show(screen({ title: 'Кому: отдел', step: { n: 1, of: 3 }, back: stepKind, body: [failed(e, stepPerson)] })); return; }
        const all = ppl.filter((p) => p.status !== 'fired').map((p) => ({ value: p.id, label: p.name, wt: [p.workTypeId, ...(p.workTypeIds || [])].filter(Boolean) }))
          .sort((x, y) => x.label.localeCompare(y.label, 'ru'));
        const peopleOf = (dep) => { const ids = new Set(wts.filter((w) => w.departmentId === dep.id).map((w) => w.id)); const own = all.filter((p) => p.wt.some((x) => ids.has(x))); return { own: own.length > 0, list: own.length ? own : all }; };
        const pickPeople = (dep) => {
          const { own, list } = dep ? peopleOf(dep) : { own: true, list: all };
          show(screen({ title: dep?.name || 'Все сотрудники', step: { n: 1, of: 3 }, back: stepPerson, body: [
            dep ? bigButton({ label: `Выдать в «${dep.name}» без фамилии`, tone: 'neutral', onClick: () => { setTarget({ issuedTo: dep.name }, `в «${dep.name}»`); afterTarget(); } }) : null,
            dep && !own ? h('p', { class: 'm-empty' }, 'В отделе пока никого: у видов работ не указан этот отдел. Показаны все сотрудники.') : null,
            choice({ items: list, empty: 'Сотрудников нет в справочнике', onPick: (o) => { setTarget({ personId: o.value, ...(dep ? { issuedTo: dep.name } : {}) }, `${dep ? dep.name + ', ' : 'на производство, '}${o.label}`); afterTarget(); } })] }));
        };
        show(screen({ title: 'Кому: отдел', step: { n: 1, of: 3 }, back: stepKind, body: [
          tiles({ items: [...deps.map((d) => ({ value: d, label: d.name })), { value: null, label: 'Все сотрудники' }], empty: 'Отделов нет — добавьте в «Справочники» → «Отделы»', onPick: (o) => pickPeople(o.value) })] }));
      };
      /** Корзина: ещё позиции на того же; выдача одним запросом; после успеха — продолжить на того же. */
      const stepCart = () => {
        const clientUid = uid();
        const msg = h('div');
        const items = S.cart.map((c, i) => ({ value: i, label: c.item.name, hint: `${fmt(c.qty)} ${unitOf(c.item)} · нажмите, чтобы убрать` }));
        show(screen({ title: 'К выдаче', step: { n: 3, of: 3 }, back: stepItem, body: [
          h('p', null, S.where),
          h('p', { class: 'm-empty' }, 'Все позиции из списка уйдут одному получателю. Добавляйте сколько нужно, потом «Выдать».'),
          bigButton({ label: 'Сменить получателя', tone: 'neutral', size: 'sm', onClick: stepKind }),
          choice({ items, empty: 'Список пуст — добавьте позицию', onPick: (o) => { S.cart.splice(o.value, 1); if (S.cart.length) stepCart(); else stepItem(); } }),
          bigButton({ label: 'Ещё позиция на этого же', tone: 'neutral', onClick: stepItem }), msg],
          foot: bigButton({ label: S.cart.length > 1 ? `Выдать всё (${S.cart.length} поз.)` : 'Выдать', onClick: async () => {
            if (!S.cart.length) { msg.replaceChildren(error('Добавьте хотя бы одну позицию.')); return; }
            msg.replaceChildren();
            try {
              await call('/stock/batch', { method: 'POST', body: { type: 'out', lines: S.cart.map((c) => ({ materialId: c.item.id, qty: c.qty })), clientUid, ...S.target } });
              const n = S.cart.length;
              const where = S.where;
              lastIssue = { target: { ...S.target }, where };
              S.cart = [];
              toast(n > 1 ? `Выдано позиций: ${n}` : 'Выдано', { ms: 2500 });
              show(screen({ title: 'Готово', body: [done({
                text: n > 1 ? `Выдано позиций: ${n}\n${where}` : `Выдано\n${where}`,
                again: { label: 'Ещё на этого же', onClick: () => { S.target = { ...lastIssue.target }; S.where = lastIssue.where; stepItem(); } },
                home: { label: 'На главный', onClick: home },
              }), bigButton({ label: 'Другому получателю', tone: 'neutral', onClick: () => { S.target = null; S.where = ''; stepKind(); } })] }));
            } catch (e) { msg.replaceChildren(failed(e)); }
          } }) }));
      };
      if (preset && lastIssue?.where) { S.item = preset; stepQty(); }
      else if (preset) stepKind();
      else stepKind();
    }

    /** «Корректировать остаток»: фактический остаток цифровой панелью + дата; запись — пересчёт склада (POST /stock/batch type:count, как в «Остатках»). */
    function correct(item, backTo) {
      const q = qty({ value: item.quantity, unit: unitOf(item) });
      const d = dateChoice();
      const msg = h('div');
      show(screen({ title: `Остаток: ${item.name}`, back: () => backTo(), body: [q.el, d.el, msg], foot: bigButton({ label: 'Записать', onClick: async () => {
        const n = q.value();
        if (!(n >= 0)) { msg.replaceChildren(error('Впишите фактический остаток.')); return; }
        msg.replaceChildren();
        try {
          const day = d.value();
          await call('/stock/batch', { method: 'POST', body: { type: 'count', lines: [{ materialId: item.id, qty: n, expected: item.quantity }], note: `Корректировка остатка на ${day.split('-').reverse().join('.')}`, clientUid: uid() } });
          const fresh = await call(`/stock/items/${item.id}`);
          toast(`Остаток: ${fresh.name} · ${fmt(fresh.quantity)} ${unitOf(fresh)}`, { ms: 3000 });
          backTo(fresh);
        } catch (e) { msg.replaceChildren(failed(e)); }
      } }) }));
    }

    // ---------- Приёмка: ожидаемая поставка → сколько ----------
    function receive(preset) {
      const S = {};
      const stepList = () => {
        const d = drill({ levels: [{ title: '', load: async () => {
          const rows = ((await call('/supply/requests', { query: { status: 'ordered,paid', limit: 100, sort: 'requestDate' } })).items || []).filter((r) => !preset || r.materialId === preset.id).sort((x, y) => (y.paid ? 1 : 0) - (x.paid ? 1 : 0));
          return rows.map((r) => ({ value: r, label: r.title || r.name || 'Позиция', hint: [r.supplierName, `ждём ${fmt(r.qty)} ${r.unit || ''}`.trim(), r.invoiceNo ? '№ ' + r.invoiceNo : ''].filter(Boolean).join(' · ') }));
        } }], empty: 'Нечего принимать — нет заказанных и оплаченных поставок', onPick: (o) => { S.req = o.value; stepQty(); } });
        show(screen({ title: 'Что приняли?', back: home, body: [d.el, bigButton({ label: 'Нет в списке — выбрать позицию', tone: 'neutral', onClick: stepItem }), bigButton({ label: 'Подать заявку на новую позицию', tone: 'ghost', onClick: requestNew })] }));
      };
      const stepItem = () => { const pick = (it) => { S.req = { id: null, qty: 1, unit: unitOf(it), name: it.name, materialId: it.id, item: it }; stepQty(); }; const d = itemDrill(pick, scanBtn(pick, stepItem)); show(screen({ title: 'Какая позиция?', back: () => { if (!d.up()) stepList(); }, body: [d.el] })); };
      const stepQty = () => {
        const r = S.req;
        const q = qty({ value: r.qty, unit: r.unit || '' });
        const msg = h('div');
        show(screen({ title: r.title || r.name || 'Позиция', back: r.id ? stepList : stepItem, body: [q.el, msg], foot: bigButton({ label: 'Принять', onClick: async () => {
          const n = q.value();
          if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
          msg.replaceChildren();
          try {
            if (r.id) await call(`/supply/requests/${r.id}/receive`, { method: 'POST', body: { qty: n, partial: n < r.qty } });
            else await call('/stock/batch', { method: 'POST', body: { type: 'in', lines: [{ materialId: r.materialId, qty: n }], clientUid: uid() } });
            toast(`Принято: ${r.title || r.name || 'Позиция'} · ${fmt(n)} ${r.unit || ''}`, { ms: 3000 }); home();
          } catch (e) { msg.replaceChildren(failed(e)); }
        } }) }));
      };
      stepList();
    }

    /** Крайний случай: позиции нет нигде — заявка менеджеру. Единственный экран с системной клавиатурой (DESIGN-MOBILE, исключение). */
    function requestNew() {
      const t = textField({ label: 'Что нужно завести на складе?', placeholder: 'Название, размер, стандарт…' });
      const q = qty({ value: '', hint: 'Количество — необязательно' });
      const msg = h('div');
      show(screen({ title: 'Новая позиция', back: () => receive(), body: [t.el, q.el, msg], foot: bigButton({ label: 'Отправить', onClick: async () => {
        const text = t.value();
        if (!text) { msg.replaceChildren(error('Опишите, какая позиция нужна.')); return; }
        msg.replaceChildren();
        const n = q.value();
        try {
          await call('/material-requests', { method: 'POST', body: { text, ...(n > 0 ? { qty: n } : {}), ...(zoneNow() ? { zoneId: zoneNow() } : {}) } });
          toast('Заявка отправлена менеджеру', { ms: 3000 }); home();
        } catch (e) { msg.replaceChildren(failed(e)); }
      } }) }));
    }

    /** Вход по QR-ссылке: «Принять» или «Выдать» эту позицию. */
    const fromCode = async (text) => {
      show(screen({ body: [h('div', { class: 'm-empty' }, 'Загружаю…')] }));
      let res;
      try { res = await itemByText(text); } catch (e) { show(screen({ back: home, body: [failed(e, () => fromCode(text))] })); return; }
      if (!res.item) { show(screen({ back: home, body: [error(res.fail.message)], foot: bigButton({ label: 'Выбрать из списка', tone: 'neutral', onClick: home }) })); return; }
      const it = res.item;
      show(screen({ title: it.name, back: home, body: [h('p', null, `На складе: ${fmt(it.quantity)} ${unitOf(it)}${artOf(it) ? ' · ' + artOf(it) : ''}`),
        bigButton({ label: 'Выдать', onClick: () => issue(it) }), bigButton({ label: 'Принять', tone: 'neutral', onClick: () => receive(it) })] }));
    };

    const start = () => { if (params?.q) fromCode(params.q); else home(); };
    show(screen({ body: [h('div', { class: 'm-empty' }, 'Загружаю…')] }));
    loadZones().then((zs) => { zones = zs; if (zs.length > 1 && !params?.q && !localStorage.getItem(askedKey())) pickZone(); else start(); }).catch(start);
    let lastQ = params?.q || '';
    return { update(p) { const q = p?.q || ''; if (q && q !== lastQ) fromCode(q); lastQ = q; },
      destroy() { alive = false; window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr); } };
  },
};
