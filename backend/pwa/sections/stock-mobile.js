import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty as fmt } from '../core/format.js';
import { mobile, errText, toast, catArt } from '../ui/kit/index.js';
import { orderLabel } from './salesorders.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { lookupCode } from './qr.js';
import { loadZones, setZone, zoneNow, zoneQuery } from '../core/zone.js';

/*
 * «Склад (телефон)» — ассистент кладовщика: главный экран «Выдать» / «Принять» + лента за 7 дней; склад и «Выйти» — в настройках (шестерёнка).
 * Собрана только из эталонов kit «mobile»; операции — те же вызовы, что у склада (POST /stock/batch, POST /supply/requests/:id/receive).
 * QR: кнопка «Сканировать QR» (mobile.scan) и вход по ссылке #stock-mobile?q=<код>.
 * Надёжность (DESIGN-MOBILE §2–3): запрос ≤ 15 с, ошибки шагов — с «Повторить», общий перехват ошибок экрана, справочники — кэш на сеанс.
 */
const { screen, bigButton, choice, tiles, feed, dateChoice, qty, textField, drill, error, scan, scanSupported } = mobile;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const call = (path, opts = {}) => api(path, { timeout: 15000, ...opts });
const memo = new Map();
/** Справочник один раз за сеанс (ключ учитывает склад); сбой кэш не запоминает. */
const once = (key, load) => { if (!memo.has(key)) memo.set(key, load().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };
const askedKey = () => 'dc-stock-zone-asked-' + (session.user?.id || 'u');
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
    const settings = () => show(screen({ title: 'Настройки', back: home, body: [
      zones.length > 1 ? bigButton({ label: `Склад: ${zoneName()} · сменить`, tone: 'neutral', onClick: pickZone }) : null,
      bigButton({ label: 'Выйти', tone: 'neutral', onClick: () => { session.clear(); window.location.reload(); } }),
    ] }));

    // ---------- Главный экран: две кнопки и лента за 7 дней ----------
    const home = () => {
      const box = h('div');
      box.append(feed({ loading: true }));
      show(screen({ title: zoneName() || 'Склад', gear: settings, body: [
        bigButton({ label: 'Выдать', onClick: () => issue() }),
        bigButton({ label: 'Принять', tone: 'neutral', onClick: () => receive() }),
        box] }));
      loadFeed().then((items) => box.replaceChildren(feed({ items }))).catch((e) => box.replaceChildren(failed(e, () => { box.replaceChildren(feed({ loading: true })); loadFeed().then((i) => box.replaceChildren(feed({ items: i }))).catch(() => box.replaceChildren(error('Лента не загрузилась.'))); })));
    };
    /** Операции текущего пользователя за 7 дней (API фильтра по автору нет — отбор по имени автора на экране). */
    const loadFeed = async () => {
      const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
      const r = await call('/stock/movements', { query: { ...zoneQuery(), from, type: 'in,out', limit: 200, sort: '-date' } });
      const me = session.name;
      return (r.items || []).filter((m) => !m.cancelledAt && !m.cancelOf && m.qty && (!me || !m.createdBy || m.createdBy === me))
        .map((m) => ({ date: dm(m.date), text: m.materialName, qty: fmt(m.qty), unit: m.unit, kind: m.type === 'in' ? 'in' : 'out' }));
    };

    // ---------- Выдача: кому (заказ и позиция заказа / производство) → позиции по одной (сколько) → список → выдать всё одной операцией ----------
    function issue(preset) {
      const S = { cart: [] };
      const inCart = (it) => S.cart.filter((c) => c.item.id === it.id).reduce((a, c) => a + c.qty, 0);
      const afterTarget = () => { if (S.cart.length) stepCart(); else if (preset) { S.item = preset; stepQty(); } else stepItem(); };
      const stepItem = () => { const pick = (it) => { S.item = it; stepQty(); }; const d = itemDrill(pick, scanBtn(pick, stepItem)); show(screen({ title: 'Что выдаём?', step: { n: 2, of: 3 }, back: () => { if (!d.up()) (S.cart.length ? stepCart() : stepKind()); }, body: [d.el] })); };
      const stepQty = (note) => {
        const it = S.item;
        const left = it.quantity - inCart(it);
        const q = qty({ value: 1, unit: unitOf(it), max: fmt(left) });
        const msg = h('div');
        if (note) msg.replaceChildren(note);
        const tooMany = (n) => { msg.replaceChildren(error(`На складе только ${fmt(it.quantity)} ${unitOf(it)}${inCart(it) ? `, из них ${fmt(inCart(it))} уже в списке` : ''}.`), bigButton({ label: 'Корректировать остаток', tone: 'neutral', onClick: () => correct(it, (fresh) => { if (fresh?.id) S.item = fresh; stepQty(); }) })); return n; };
        show(screen({ title: it.name, step: { n: 2, of: 3 }, back: stepItem, body: [q.el, msg], foot: bigButton({ label: 'Дальше', onClick: () => {
          const n = q.value();
          if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
          if (n > left) { tooMany(n); return; }
          S.cart.push({ item: it, qty: n }); stepCart();
        } }) }));
      };
      const stepKind = () => show(screen({ title: 'Кому выдаём?', step: { n: 1, of: 3 }, back: () => (S.cart.length ? stepCart() : home()),
        body: [choice({ items: [{ value: 'order', label: 'На заказ' }, { value: 'person', label: 'На производство' }], onPick: (o) => (o.value === 'order' ? stepOrder() : stepPerson()) })] }));
      /** Заказ → его позиции: выдаём на точную позицию (salesOrderLineId, заказ сервер берёт из неё); без позиций — на весь заказ. */
      const stepOrder = () => {
        let orders = [];
        const d = drill({ levels: [
          { title: '', load: async () => { orders = await ordersLookup({ filter: 'active', lines: true }); return orders.map((o) => ({ value: o.id, label: orderLabel(o), hint: [o.title, (o.lines || []).length ? `${o.lines.length} поз.` : ''].filter(Boolean).join(' · ') })); } },
          { title: '', load: async ([id]) => {
            const o = orders.find((x) => x.id === id) || {};
            const lines = (o.lines || []).map((l, i) => ({ value: { line: l.id, o }, label: `${l.seqNo ?? l.lineNo ?? i + 1}. ${String(l.title || 'Позиция').slice(0, 90)}` }));
            return [...lines, { value: { line: null, o }, label: 'На весь заказ — без позиции' }];
          } }], empty: 'Заказов в работе нет',
          onPick: (it) => { const { line, o } = it.value; S.target = line ? { salesOrderLineId: line } : { salesOrderId: o.id }; S.where = `на заказ ${orderLabel(o)}${line ? ', поз. ' + it.label : ''}`; afterTarget(); } });
        show(screen({ title: 'Заказ и позиция', step: { n: 1, of: 3 }, back: () => { if (!d.up()) stepKind(); }, body: [d.el] }));
      };
      /** Кому: сначала отдел (справочник «Отделы» — новый появится сам), затем его сотрудники (по видам работ: вид работ → отдел, ОТД-1); без фамилии — выдача в отдел (issuedTo). */
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
            dep ? bigButton({ label: `Выдать в «${dep.name}» без фамилии`, tone: 'neutral', onClick: () => { S.target = { issuedTo: dep.name }; S.where = `в «${dep.name}»`; afterTarget(); } }) : null,
            dep && !own ? h('p', { class: 'm-empty' }, h('small', null, 'В отделе пока никого: у видов работ не указан этот отдел. Показаны все сотрудники.')) : null,
            choice({ items: list, empty: 'Сотрудников нет в справочнике', onPick: (o) => { S.target = { personId: o.value, ...(dep ? { issuedTo: dep.name } : {}) }; S.where = `${dep ? dep.name + ', ' : 'на производство, '}${o.label}`; afterTarget(); } })] }));
        };
        show(screen({ title: 'Кому: отдел', step: { n: 1, of: 3 }, back: stepKind, body: [
          tiles({ items: [...deps.map((d) => ({ value: d, label: d.name })), { value: null, label: 'Все сотрудники' }], empty: 'Отделов нет — добавьте в «Справочники» → «Отделы»', onPick: (o) => pickPeople(o.value) })] }));
      };
      /** Список к выдаче: «Добавить позицию» — ещё одна на того же получателя; «Убрать» — лишняя; «Выдать» — одна операция на всё (всё или ничего). */
      const stepCart = () => {
        const clientUid = uid(); // повтор после сбоя связи не задвоит выдачу
        const msg = h('div');
        const items = S.cart.map((c, i) => ({ value: i, label: c.item.name, hint: `${fmt(c.qty)} ${unitOf(c.item)} · нажмите, чтобы убрать` }));
        show(screen({ title: 'Выдать?', step: { n: 3, of: 3 }, back: stepItem, body: [
          h('p', null, S.where), bigButton({ label: 'Сменить получателя', tone: 'ghost', size: 'sm', onClick: stepKind }),
          choice({ items, onPick: (o) => { S.cart.splice(o.value, 1); if (S.cart.length) stepCart(); else stepItem(); } }),
          bigButton({ label: 'Добавить позицию', tone: 'neutral', onClick: stepItem }), msg],
          foot: bigButton({ label: S.cart.length > 1 ? `Выдать всё (${S.cart.length} поз.)` : 'Выдать', onClick: async () => {
            msg.replaceChildren();
            try {
              await call('/stock/batch', { method: 'POST', body: { type: 'out', lines: S.cart.map((c) => ({ materialId: c.item.id, qty: c.qty })), clientUid, ...S.target } });
              const c0 = S.cart[0];
              toast(S.cart.length > 1 ? `Выдано позиций: ${S.cart.length} · ${S.where}` : `Выдано: ${c0.item.name} · ${fmt(c0.qty)} ${unitOf(c0.item)}`, { ms: 3000 }); home();
            } catch (e) { msg.replaceChildren(failed(e)); }
          } }) }));
      };
      stepKind();
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
