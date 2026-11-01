import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty as fmt } from '../core/format.js';
import { mobile, errText, toast, catArt } from '../ui/kit/index.js';
import { activeOrders, orderLabel } from './salesorders.js';
import { peopleByWork } from './issue.js';
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

    // ---------- Выдача: категория → позиция → сколько → кому → подтвердить ----------
    function issue(preset) {
      const S = {};
      const stepItem = () => { const pick = (it) => { S.item = it; stepQty(); }; const d = itemDrill(pick, scanBtn(pick, stepItem)); show(screen({ step: { n: 1, of: 4 }, back: () => { if (!d.up()) home(); }, body: [d.el] })); };
      const stepQty = (note) => {
        const it = S.item;
        const q = qty({ value: S.qty || 1, unit: unitOf(it), max: fmt(it.quantity) });
        const msg = h('div');
        if (note) msg.replaceChildren(note);
        const tooMany = (n) => { msg.replaceChildren(error(`На складе только ${fmt(it.quantity)} ${unitOf(it)}.`), bigButton({ label: 'Корректировать остаток', tone: 'neutral', onClick: () => correct(it, (fresh) => { if (fresh?.id) S.item = fresh; stepQty(); }) })); return n; };
        show(screen({ title: it.name, step: { n: 2, of: 4 }, back: stepItem, body: [q.el, msg], foot: bigButton({ label: 'Дальше', onClick: () => {
          const n = q.value();
          if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
          if (n > it.quantity) { tooMany(n); return; }
          S.qty = n; stepKind();
        } }) }));
      };
      const stepKind = () => show(screen({ title: 'На что выдаём?', step: { n: 3, of: 4 }, back: stepQty,
        body: [choice({ items: [{ value: 'order', label: 'На заказ' }, { value: 'person', label: 'На производство' }], onPick: (o) => (o.value === 'order' ? stepOrder() : stepPerson()) })] }));
      const stepOrder = () => {
        const d = drill({ levels: [{ title: '', load: async () => (await activeOrders()).map((o) => ({ value: o.id, label: orderLabel(o), hint: o.title || '' })) }], empty: 'Заказов в работе нет',
          onPick: (o) => { S.target = { salesOrderId: o.value }; S.where = `на заказ ${o.label}`; stepSure(); } });
        show(screen({ title: 'Заказ', step: { n: 3, of: 4 }, back: stepKind, body: [d.el] }));
      };
      /** Кому: отделы крупными кнопками (если есть виды работ) и сотрудники выбранного отдела или все. */
      const stepPerson = async () => {
        show(screen({ title: 'Кому', step: { n: 3, of: 4 }, back: stepKind, body: [h('div', { class: 'm-empty' }, 'Загружаю…')] }));
        let groups;
        try { groups = await once('people', () => peopleByWork()); } catch (e) { show(screen({ title: 'Кому', step: { n: 3, of: 4 }, back: stepKind, body: [failed(e, stepPerson)] })); return; }
        const hasGroups = groups.some((g) => g.group !== 'Без вида работ');
        let cur = '';
        const paint = () => {
          const people = groups.filter((g) => !cur || g.group === cur).flatMap((g) => g.people.map((p) => ({ value: p.id, label: p.name })));
          show(screen({ title: 'Кому', step: { n: 3, of: 4 }, back: stepKind, body: [
            hasGroups ? tiles({ items: [{ value: '', label: 'Все' }, ...groups.map((g) => ({ value: g.group, label: g.group }))], selected: cur, onPick: (o) => { cur = o.value; paint(); } }) : null,
            choice({ items: people, empty: 'Сотрудников нет в справочнике', onPick: (o) => { S.target = { personId: o.value }; S.where = `на производство, ${o.label}`; stepSure(); } })] }));
        };
        paint();
      };
      const stepSure = () => {
        const clientUid = uid(); // повтор после сбоя связи не задвоит выдачу
        const msg = h('div');
        const line = `${S.item.name} · ${fmt(S.qty)} ${unitOf(S.item)}`;
        show(screen({ title: 'Выдать?', step: { n: 4, of: 4 }, back: stepKind, body: [h('p', null, `${line} · ${S.where}`), msg],
          foot: bigButton({ label: 'Выдать', onClick: async () => {
            msg.replaceChildren();
            try {
              await call('/stock/batch', { method: 'POST', body: { type: 'out', lines: [{ materialId: S.item.id, qty: S.qty }], clientUid, ...S.target } });
              toast(`Выдано: ${line}`, { ms: 3000 }); home();
            } catch (e) { msg.replaceChildren(failed(e)); }
          } }) }));
      };
      if (preset) { S.item = preset; stepQty(); } else stepItem();
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
