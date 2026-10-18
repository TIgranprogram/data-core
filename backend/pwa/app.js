/* «Склад · Снабжение» — PWA на единой базе (без сборки, vanilla JS).
 * Данные — ОБЩИЕ с CRM kppdf (docs/UNIFY-SUPPLY-WAREHOUSE.md):
 *   заявки  → /api/supply/requests (коллекция supplyrequests),
 *   склад   → /api/stock/items (materials + storageitems), движения — /api/stock/items/:id/move.
 * Офлайн: данные кэшируются в IndexedDB, изменения копятся в очереди (outbox) и досылаются.
 * Без дублей: у каждой операции свой clientUid — сервер не проводит её дважды.
 */
(() => {
  'use strict';
  // ---------- Константы ----------
  const PREFIX = location.pathname.replace(/\/app(\/.*)?$/, '');       // '' или '/db'
  const API = PREFIX + '/api';
  const STATUSES = ['✅ Заказать', '⏳ Ожидает', '💰 Оплачено', '⚙️ В работе', '☑️ Получено', '❌ Отменено'];
  const STATUS_CLASS = { 'Заказать': 'b-order', 'Ожидает': 'b-wait', 'Оплачено': 'b-paid', 'В работе': 'b-work', 'Получено': 'b-done', 'Отменено': 'b-cancel' };
  const PRIORITIES = ['Срочно', 'Обычный', 'Низко'];
  const MOVE = {
    in: { label: 'Приход', hint: 'Поступление на склад.' },
    reserve: { label: 'Бронь', hint: 'Резерв под заказ: остаток не меняется, «свободно» уменьшается.' },
    unreserve: { label: 'Снять бронь', hint: 'Возврат резерва в свободный остаток.' },
    out: { label: 'Списание', hint: 'Выдача в производство / расход.' },
    adjust: { label: 'Корректировка', hint: 'Инвентаризация: «+» — излишек, «−» — недостача.' },
  };
  const PAGE = 100;

  // ---------- Утилиты ----------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fmtDate = (s) => { if (!s) return ''; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(s); };
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const fmtNum = (n) => (Math.round(n * 1000) / 1000).toLocaleString('ru-RU');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const statusWord = (s) => String(s || '').replace(/^[^\p{L}]+/u, '').trim();
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 3500); }

  // ---------- Сессия ----------
  const S = {
    get access() { return localStorage.getItem('dca_access') || ''; }, set access(v) { v ? localStorage.setItem('dca_access', v) : localStorage.removeItem('dca_access'); },
    get refresh() { return localStorage.getItem('dca_refresh') || ''; }, set refresh(v) { v ? localStorage.setItem('dca_refresh', v) : localStorage.removeItem('dca_refresh'); },
    get user() { try { return JSON.parse(localStorage.getItem('dca_user') || 'null'); } catch { return null; } },
    set user(v) { v ? localStorage.setItem('dca_user', JSON.stringify(v)) : localStorage.removeItem('dca_user'); },
  };
  const me = () => S.user?.displayName || S.user?.username || '';
  class NetError extends Error {}
  class AuthError extends Error {}

  async function rawFetch(path, opts, token) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Таймаут: на плохой связи запрос не должен висеть бесконечно (загрузка фото — дольше)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.body instanceof FormData ? 120000 : 20000);
    try { return await fetch(API + path, { ...opts, headers, signal: ctrl.signal }); }
    catch { throw new NetError('Нет связи с сервером'); }
    finally { clearTimeout(timer); }
  }
  async function refreshAccess() {
    if (!S.refresh) throw new AuthError('Войдите снова');
    const res = await rawFetch('/auth/refresh', { method: 'POST' }, S.refresh);
    if (!res.ok) throw new AuthError('Сессия истекла — войдите снова');
    S.access = (await res.json()).access;
  }
  async function api(path, opts = {}) {
    let res = await rawFetch(path, opts, S.access);
    if (res.status === 401 && S.refresh) { await refreshAccess(); res = await rawFetch(path, opts, S.access); }
    if (res.status === 401) throw new AuthError('Сессия истекла — войдите снова');
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || msg; } catch { /* */ }
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res.status === 204 ? null : res.json();
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

  // ---------- IndexedDB: кэш данных и очередь изменений ----------
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('datacore-app', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('cache'); r.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); }); };
    return {
      get: (k) => tx('cache', 'readonly', (s) => s.get(k)),
      set: (k, v) => tx('cache', 'readwrite', (s) => s.put(v, k)),
      queue: () => tx('outbox', 'readonly', (s) => s.getAll()),
      push: (op) => tx('outbox', 'readwrite', (s) => s.add(op)),
      del: (seq) => tx('outbox', 'readwrite', (s) => s.delete(seq)),
    };
  })();

  // ---------- Данные сервера → вид приложения ----------
  // Заявка CRM (supplyrequests) → строка «Снабжения»
  const reqView = (r) => ({
    key: r.clientUid || r.id, id: r.id, num: r.num, date: (r.requestDate || r.createdAt || '').slice(0, 10),
    name: r.title || r.materialName || '', category: r.categoryName || '', qty: r.qty, unit: r.unit, article: r.article, color: r.color,
    supplier: r.supplierName || '', link: r.productUrl || r.sheetExtra?.link || '', customer: r.orderLabel || '', status: r.statusLabel,
    priority: r.priorityLabel, ourCompany: r.companyName || '', delivery: r.deliveryNote || '', invoiceNo: r.invoiceNo || '',
    priceWithVat: r.priceHint, note: r.notes || '', requestedBy: r.requestedBy || '', received: r.status === 'received',
    receivedQty: r.receivedQty, materialId: r.materialId || null,
  });
  // Форма заявки → тело запроса /api/supply/requests
  const reqBody = (v) => clean({
    title: v.name ?? undefined, categoryName: v.category ?? '', qty: v.qty ?? undefined, unit: v.unit ?? '', article: v.article ?? '',
    color: v.color ?? '', supplierName: v.supplier ?? '', productUrl: v.link ?? '', orderLabel: v.customer ?? '',
    statusLabel: v.status ?? undefined, priorityLabel: v.priority ?? undefined, companyName: v.ourCompany ?? '',
    deliveryNote: v.delivery ?? '', invoiceNo: v.invoiceNo ?? '', priceHint: v.priceWithVat ?? undefined, notes: v.note ?? '',
  });
  // Позиция склада (materials + storageitems) → строка «Склада»
  const itemView = (i) => ({
    key: i.id, id: i.id, name: i.name, category: i.categoryName || '', unit: i.unit, article: i.article, minQty: i.minQuantity,
    weightKg: i.weightKg, photos: i.photos || [], onHand: num(i.quantity), reserved: num(i.reservedQty),
  });
  const itemBody = (v) => clean({ name: v.name ?? undefined, categoryName: v.category ?? undefined, unit: v.unit ?? undefined, article: v.article ?? undefined, minQuantity: v.minQty ?? undefined, weightKg: v.weightKg ?? undefined });

  // ---------- Состояние ----------
  const st = { requests: [], items: [], lookups: { suppliers: [], companies: [], categories: [] }, queue: [], online: navigator.onLine, syncing: false, view: 'supply' };
  const sFilter = { q: '', status: '', cat: '', sup: '', who: '', co: '', shown: PAGE };
  const wFilter = { q: '', mode: '', cat: '', shown: PAGE };

  async function refreshData() {
    const [reqs, items, lookups] = await Promise.all([api('/supply/requests?limit=1000'), api('/stock/items?limit=1000'), api('/supply/lookups')]);
    st.requests = reqs.items.map(reqView);
    st.items = items.items.map(itemView);
    st.lookups = lookups;
    await Promise.all([idb.set('v2.requests', st.requests), idb.set('v2.items', st.items), idb.set('v2.lookups', st.lookups)]);
    applyQueueLocally();
  }
  async function loadCache() {
    st.requests = (await idb.get('v2.requests')) || [];
    st.items = (await idb.get('v2.items')) || [];
    st.lookups = (await idb.get('v2.lookups')) || st.lookups;
    st.queue = await idb.queue();
    applyQueueLocally();
  }
  const findReq = (key) => st.requests.find((r) => r.key === key || r.id === key);
  const findItem = (ref) => st.items.find((i) => (ref.id && i.id === ref.id) || (ref.name && norm(i.name) === norm(ref.name)));

  // Неотправленные изменения показываем сразу (оптимистично)
  function applyOp(op) {
    if (op.kind === 'req.create' && !findReq(op.key)) st.requests.unshift({ ...op.view, key: op.key, _pending: true });
    if (op.kind === 'req.patch') { const r = findReq(op.key); if (r) Object.assign(r, op.view, { _pending: true }); }
    if (op.kind === 'req.receive') {
      const r = findReq(op.key); if (r) Object.assign(r, { status: STATUSES[4], received: true, _pending: true });
      const i = findItem({ name: op.itemName }); if (i) { i.onHand += op.qty; i._pending = true; }
      else st.items.unshift({ key: 'new:' + op.itemName, name: op.itemName, unit: r?.unit, category: r?.category, onHand: op.qty, reserved: 0, photos: [], _pending: true });
    }
    if (op.kind === 'item.create' && !findItem({ name: op.view.name })) st.items.unshift({ ...op.view, key: 'new:' + op.view.name, onHand: 0, reserved: 0, photos: [], _pending: true });
    if (op.kind === 'item.patch') { const i = findItem(op.ref); if (i) Object.assign(i, op.view, { _pending: true }); }
    if (op.kind === 'item.photo') { const i = findItem(op.ref); if (i) i._pendingPhotos = (i._pendingPhotos || 0) + 1; }
    if (op.kind === 'item.move') {
      const i = findItem(op.ref); if (!i) return;
      const q = num(op.qty);
      if (op.type === 'in') i.onHand += q;
      if (op.type === 'out') { i.onHand -= q; i.reserved = Math.max(0, i.reserved - q); }
      if (op.type === 'adjust') i.onHand += q;
      if (op.type === 'reserve') i.reserved += q;
      if (op.type === 'unreserve') i.reserved = Math.max(0, i.reserved - q);
      i._pending = true;
    }
  }
  function applyQueueLocally() { for (const op of st.queue) applyOp(op); }

  // ---------- Очередь изменений ----------
  async function enqueue(op) {
    op.at = Date.now();
    op.clientUid = op.clientUid || uuid();
    await idb.push(op);
    st.queue = await idb.queue();
    applyOp(op);
    render(); updateNet();
    flush();
  }
  // id заявки: известен сразу или после создания (ищем по clientUid в свежем списке)
  async function reqId(key) {
    const local = st.requests.find((r) => (r.key === key || r.id === key) && r.id);
    if (local) return local.id;
    const list = await api('/supply/requests?limit=1000');
    const hit = list.items.find((r) => r.clientUid === key || r.id === key);
    return hit ? hit.id : null;
  }
  // id позиции: по id или по наименованию (новая позиция, созданная офлайн)
  async function itemId(ref) {
    if (ref.id) return ref.id;
    const r = await api('/stock/items?limit=50&search=' + encodeURIComponent(ref.name));
    const hit = r.items.find((i) => norm(i.name) === norm(ref.name));
    return hit ? hit.id : null;
  }
  const notYet = () => Object.assign(new Error('Запись ещё не создана'), { retry: true });
  async function runOp(op) {
    switch (op.kind) {
      case 'req.create': await post('/supply/requests', { ...op.body, clientUid: op.key }); return;
      case 'req.patch': { const id = await reqId(op.key); if (!id) throw notYet(); await patch(`/supply/requests/${id}`, op.body); return; }
      case 'req.receive': {
        const id = await reqId(op.key); if (!id) throw notYet();
        try { await post(`/supply/requests/${id}/receive`, { qty: op.qty, clientUid: op.clientUid }); }
        catch (e) { if (e.status !== 409) throw e; }   // уже оприходована (повтор) — не ошибка
        return;
      }
      case 'item.create': await post('/stock/items', op.body); return;
      case 'item.patch': { const id = await itemId(op.ref); if (!id) throw notYet(); await patch(`/stock/items/${id}`, op.body); return; }
      case 'item.move': { const id = await itemId(op.ref); if (!id) throw notYet(); await post(`/stock/items/${id}/move`, { type: op.type, qty: op.qty, note: op.note, clientUid: op.clientUid }); return; }
      case 'item.photo': {
        const id = await itemId(op.ref); if (!id) throw notYet();
        const fd = new FormData(); fd.append('file', op.blob, op.name || 'photo.jpg');
        const photo = await api('/photos/upload', { method: 'POST', body: fd });
        await post(`/stock/items/${id}/photos`, { photoId: photo.id || photo._id });
        return;
      }
      default: return; // операции старого формата (до объединения баз) — просто убираем
    }
  }
  async function flush() {
    if (st.syncing) { st.again = true; return; }
    if (!navigator.onLine) return;
    st.syncing = true; updateNet();
    let changed = false;
    try {
      // Крутим, пока очередь не опустеет: операции, добавленные во время отправки, тоже уходят.
      let stop = false, netFail = false;
      for (let pass = 0; pass < 20 && !stop; pass++) {
        const ops = await idb.queue();
        if (!ops.length) break;
        for (const op of ops) {
          try { await runOp(op); await idb.del(op.seq); changed = true; }
          catch (e) {
            if (e instanceof NetError) { stop = true; netFail = true; break; }
            if (e instanceof AuthError) { toast(e.message); showLogin(); stop = true; break; }
            if (e.retry) { stop = true; break; }
            await idb.del(op.seq); toast('Не сохранено: ' + e.message); changed = true;  // ошибка данных — не зацикливаемся
          }
        }
      }
      st.queue = await idb.queue();
      if (!netFail && (changed || !st.queue.length)) await refreshData();
      st.online = !netFail;
    } catch (e) {
      if (e instanceof NetError) st.online = false;
      else if (e instanceof AuthError) showLogin();
    } finally {
      st.syncing = false; render(); updateNet(); reopenCurrent();
      if (st.again) { st.again = false; setTimeout(flush, 0); }
    }
  }
  function updateNet() {
    const n = $('#net'); const q = st.queue.length;
    const off = !navigator.onLine || !st.online;
    n.className = 'net' + (off ? ' off' : q ? ' queue' : '');
    n.textContent = off ? `нет связи${q ? ' · в очереди ' + q : ''}` : st.syncing ? 'синхронизация…' : q ? `отправка: ${q}` : 'онлайн';
  }

  // ---------- Остатки ----------
  const stockOf = (i) => ({ onHand: i.onHand, reserved: i.reserved, free: i.onHand - i.reserved });
  function stockBadge(item, s) {
    const min = num(item.minQty);
    if (s.onHand <= 0) return ['нет', 'b-zero'];
    if (min > 0 && s.free < min) return ['к закупке', 'b-low'];
    return ['в норме', 'b-done'];
  }

  // ---------- Снабжение ----------
  function fillSelect(sel, values, allLabel, current) {
    sel.replaceChildren();
    const o = el('option', '', allLabel); o.value = ''; sel.append(o);
    values.forEach((v) => { const x = el('option', '', v); x.value = v; sel.append(x); });
    sel.value = current || '';
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const catNames = () => uniq([...st.lookups.categories.map((c) => c.name), ...st.items.map((i) => i.category), ...st.requests.map((r) => r.category)]);

  function renderSupply() {
    const all = st.requests;
    const chips = $('#s-chips'); chips.replaceChildren();
    const counts = {}; all.forEach((r) => { const w = statusWord(r.status) || 'без статуса'; counts[w] = (counts[w] || 0) + 1; });
    const mk = (label, val, n) => { const b = el('button', 'chip' + (sFilter.status === val ? ' active' : ''), n != null ? `${label} ${n}` : label); b.onclick = () => { sFilter.status = sFilter.status === val ? '' : val; sFilter.shown = PAGE; render(); }; chips.append(b); };
    mk('Все', '', all.length);
    STATUSES.map(statusWord).forEach((w) => { if (counts[w]) mk(w, w, counts[w]); });
    fillSelect($('#s-cat'), catNames(), 'Все категории', sFilter.cat);
    fillSelect($('#s-sup'), uniq([...st.lookups.suppliers, ...all.map((r) => r.supplier)]), 'Все поставщики', sFilter.sup);
    fillSelect($('#s-who'), uniq(all.map((r) => r.requestedBy)), 'Кто подал: все', sFilter.who);
    fillSelect($('#s-co'), uniq([...st.lookups.companies, ...all.map((r) => r.ourCompany)]), 'Все компании', sFilter.co);
    $('#suppliers').replaceChildren(...uniq([...st.lookups.suppliers, ...all.map((r) => r.supplier)]).map((v) => { const o = el('option'); o.value = v; return o; }));

    const q = norm(sFilter.q);
    const list = all.filter((r) =>
      (!sFilter.status || statusWord(r.status) === sFilter.status) &&
      (!sFilter.cat || r.category === sFilter.cat) && (!sFilter.sup || String(r.supplier || '').trim() === sFilter.sup) &&
      (!sFilter.who || String(r.requestedBy || '').trim() === sFilter.who) && (!sFilter.co || r.ourCompany === sFilter.co) &&
      (!q || norm([r.name, r.article, r.supplier, r.note, r.customer, r.num].join(' ')).includes(q)))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || num(b.num) - num(a.num));
    $('#s-count').textContent = `Заявок: ${list.length}`;
    const ul = $('#s-list'); ul.replaceChildren();
    list.slice(0, sFilter.shown).forEach((r) => {
      const li = el('li', 'row');
      const item = r.materialId ? st.items.find((i) => i.id === r.materialId) : null;
      li.append(thumbOf(item || {}));
      const main = el('div', 'row-main');
      main.append(el('div', 'row-title', (r.num ? `№${r.num} · ` : '') + (r.name || '—')));
      main.append(el('div', 'row-sub', [r.qty != null ? `${fmtNum(num(r.qty))} ${r.unit || ''}`.trim() : '', r.supplier, r.requestedBy, fmtDate(r.date)].filter(Boolean).join(' · ')));
      const side = el('div', 'row-side');
      const w = statusWord(r.status);
      side.append(el('span', 'badge ' + (STATUS_CLASS[w] || ''), w || '—'));
      if (r.priority === 'Срочно') side.append(el('div', 'small error', 'срочно'));
      if (r._pending) side.append(el('div', 'pending', 'не отправлено'));
      li.append(main, side);
      li.onclick = () => openRequest(r);
      ul.append(li);
    });
    $('#s-more').hidden = list.length <= sFilter.shown;
  }

  function thumbOf(doc) {
    const p = (doc.photos || [])[0];
    if (p) { const img = el('img', 'thumb'); img.src = PREFIX + (p.thumb || p.url); img.alt = ''; img.loading = 'lazy'; return img; }
    return el('div', 'thumb', doc._pendingPhotos ? '⏳' : '📦');
  }
  function renderPhotos(box, item) {
    box.replaceChildren();
    (item.photos || []).forEach((p) => { const img = el('img'); img.src = PREFIX + (p.thumb || p.url); img.alt = ''; img.onclick = () => window.open(PREFIX + p.url, '_blank'); box.append(img); });
    if (item._pendingPhotos) box.append(el('span', 'muted small', `⏳ фото в очереди: ${item._pendingPhotos}`));
    const add = el('button', 'add', '+ Фото'); add.type = 'button';
    add.onclick = () => pickPhoto(item);
    box.append(add);
  }
  function pickPhoto(item) {
    const inp = $('#photo-input');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 10 * 1024 * 1024) { toast('Фото больше 10 МБ'); return; }
      await enqueue({ kind: 'item.photo', ref: { id: item.id, name: item.name }, blob: f, name: f.name });
      toast(navigator.onLine ? 'Фото загружается…' : 'Фото сохранено и отправится при появлении связи');
      reopenCurrent();
    };
    inp.click();
  }

  let current = null; // { type: 'req'|'item', key, isNew }
  function reopenCurrent() {
    if (!current || current.type !== 'item') return;
    const item = st.items.find((i) => i.key === current.key || (current.name && norm(i.name) === norm(current.name)));
    if (!item) return;
    renderPhotos($('#item-photos'), item);
    renderItemStats(item);
  }

  function setFormValues(form, doc) {
    [...form.elements].forEach((f) => { if (f.name) f.value = doc[f.name] != null ? doc[f.name] : ''; });
  }
  function formValues(form, numeric) {
    const out = {};
    [...form.elements].forEach((f) => {
      if (!f.name) return;
      let v = f.value.trim();
      if (v === '') { out[f.name] = null; return; }
      if (numeric.includes(f.name)) v = num(v);
      out[f.name] = v;
    });
    return out;
  }
  function ensureOption(sel, value) { if (value && sel.value !== value) { const o = el('option', '', value); o.value = value; sel.append(o); sel.value = value; } }

  function openRequest(r) {
    const f = $('#req-form');
    fillSelect(f.elements.category, catNames(), '—', ''); fillSelect(f.elements.status, STATUSES, '—', '');
    fillSelect(f.elements.priority, PRIORITIES, '—', ''); fillSelect(f.elements.ourCompany, st.lookups.companies, '—', '');
    const isNew = !r;
    const doc = r || { key: uuid(), status: STATUSES[0], priority: 'Обычный', unit: 'шт', ourCompany: st.lookups.companies[0] || '', requestedBy: me() };
    current = { type: 'req', key: doc.key, isNew };
    setFormValues(f, doc);
    for (const k of ['category', 'status', 'priority', 'ourCompany']) ensureOption(f.elements[k], doc[k]);
    $('#req-title').textContent = isNew ? 'Новая заявка' : `Заявка${doc.num ? ' №' + doc.num : ''}`;
    $('#req-meta').textContent = isNew ? '' : [doc.requestedBy && `Подал: ${doc.requestedBy}`, doc.date && `дата ${fmtDate(doc.date)}`, doc.received && `оприходовано${doc.receivedQty ? ': ' + fmtNum(doc.receivedQty) : ''}`].filter(Boolean).join(' · ');
    $('#req-photos').hidden = true;
    $('#req-receive').hidden = isNew || !!doc.received;
    $('#req-dlg').showModal();
  }
  $('#req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = formValues(e.target, ['qty', 'priceWithVat']);
    if (!vals.name) return;
    const view = { ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v ?? ''])), qty: vals.qty ?? 1 };
    if (current.isNew) {
      const maxNum = st.requests.reduce((m, r) => Math.max(m, num(r.num)), 0);
      await enqueue({ kind: 'req.create', key: current.key, body: { ...reqBody(vals), requestedBy: me() }, view: { ...view, num: maxNum + 1, date: new Date().toISOString().slice(0, 10), requestedBy: me() } });
      toast('Заявка создана');
    } else {
      await enqueue({ kind: 'req.patch', key: current.key, body: reqBody(vals), view });
      toast('Сохранено');
    }
    $('#req-dlg').close();
  });
  $('#req-receive').addEventListener('click', () => {
    const r = findReq(current.key);
    const match = (r.materialId && st.items.find((i) => i.id === r.materialId)) || st.items.find((i) => norm(i.name) === norm(r.name));
    openMove('in', match || null, { request: r });
  });

  // ---------- Склад ----------
  function renderStock() {
    const items = st.items;
    const withStock = items.map((i) => ({ i, s: stockOf(i) }));
    const low = withStock.filter(({ i, s }) => stockBadge(i, s)[0] !== 'в норме');
    const chips = $('#w-chips'); chips.replaceChildren();
    const mk = (label, val, n) => { const b = el('button', 'chip' + (wFilter.mode === val ? ' active' : ''), `${label} ${n}`); b.onclick = () => { wFilter.mode = wFilter.mode === val ? '' : val; wFilter.shown = PAGE; render(); }; chips.append(b); };
    mk('Все', '', items.length);
    mk('К закупке / нет', 'low', low.length);
    mk('В брони', 'res', withStock.filter(({ s }) => s.reserved > 0).length);
    fillSelect($('#w-cat'), catNames(), 'Все категории', wFilter.cat);
    $('#items-list').replaceChildren(...items.map((i) => { const o = el('option'); o.value = i.name; return o; }));

    const q = norm(wFilter.q);
    const list = withStock.filter(({ i, s }) =>
      (!wFilter.cat || i.category === wFilter.cat) &&
      (wFilter.mode !== 'low' || stockBadge(i, s)[0] !== 'в норме') && (wFilter.mode !== 'res' || s.reserved > 0) &&
      (!q || norm([i.name, i.article, i.category].join(' ')).includes(q)))
      .sort((a, b) => String(a.i.name).localeCompare(String(b.i.name), 'ru'));
    $('#w-count').textContent = `Позиций: ${list.length}`;
    const ul = $('#w-list'); ul.replaceChildren();
    list.slice(0, wFilter.shown).forEach(({ i, s }) => {
      const li = el('li', 'row');
      li.append(thumbOf(i));
      const main = el('div', 'row-main');
      main.append(el('div', 'row-title', i.name || '—'));
      main.append(el('div', 'row-sub', [i.category, i.unit, i.article, s.reserved > 0 ? `бронь ${fmtNum(s.reserved)}` : ''].filter(Boolean).join(' · ')));
      const side = el('div', 'row-side');
      side.append(el('div', 'qty', fmtNum(s.onHand)));
      const [t, c] = stockBadge(i, s);
      side.append(el('span', 'badge ' + c, s.free !== s.onHand ? `своб. ${fmtNum(s.free)}` : t));
      if (i._pending) side.append(el('div', 'pending', 'не отправлено'));
      li.append(main, side);
      li.onclick = () => openItem(i);
      ul.append(li);
    });
    $('#w-more').hidden = list.length <= wFilter.shown;
  }

  const HIST_LABEL = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', reserve: 'Бронь', unreserve: 'Снятие брони', transfer: 'Перемещение' };
  async function renderItemStats(item) {
    const s = stockOf(item);
    const box = $('#item-stats'); box.replaceChildren();
    [['Остаток', s.onHand], ['В брони', s.reserved], ['Свободно', s.free]].forEach(([l, v]) => { const d = el('div', 'stat', l); d.prepend(el('b', '', fmtNum(v))); box.append(d); });
    const ul = $('#item-moves');
    if (!item.id) { ul.replaceChildren(el('li', 'muted', 'История появится после отправки')); return; }
    ul.replaceChildren(el('li', 'muted', 'Загрузка истории…'));
    try {
      const h = await api(`/stock/items/${item.id}/history`);
      ul.replaceChildren();
      if (!h.items.length) ul.append(el('li', 'muted', 'Движений пока нет'));
      h.items.slice(0, 100).forEach((m) => {
        const sign = m.type === 'out' ? '−' : m.type === 'in' ? '+' : '';
        ul.append(el('li', '', [fmtDate(m.date), HIST_LABEL[m.type] || m.type, `${sign}${fmtNum(Math.abs(num(m.qty)))}`, m.note].filter(Boolean).join(' · ')));
      });
    } catch (e) {
      ul.replaceChildren(el('li', 'muted', e instanceof NetError ? 'История недоступна без связи' : 'Не удалось загрузить историю'));
    }
  }
  function openItem(i) {
    const f = $('#item-form');
    fillSelect(f.elements.category, catNames(), '—', '');
    const isNew = !i;
    const doc = i || { unit: 'шт' };
    current = { type: 'item', key: doc.key, name: doc.name, isNew };
    setFormValues(f, doc);
    ensureOption(f.elements.category, doc.category);
    $('#item-title').textContent = isNew ? 'Новая позиция' : doc.name;
    const acts = $('#item-actions'); acts.replaceChildren();
    if (!isNew) {
      ['in', 'reserve', 'unreserve', 'out', 'adjust'].forEach((t) => { const b = el('button', 'btn', MOVE[t].label); b.type = 'button'; b.onclick = () => openMove(t, doc); acts.append(b); });
      const toReq = el('button', 'btn', 'В заявку'); toReq.type = 'button';
      toReq.onclick = () => { $('#item-dlg').close(); openRequest(null); const rf = $('#req-form'); rf.elements.name.value = doc.name || ''; rf.elements.unit.value = doc.unit || 'шт'; rf.elements.article.value = doc.article || ''; ensureOption(rf.elements.category, doc.category); };
      acts.append(toReq);
      renderItemStats(doc);
    } else { $('#item-stats').replaceChildren(); $('#item-moves').replaceChildren(); }
    $('#item-stats').hidden = isNew; $('#item-moves').hidden = isNew; acts.hidden = isNew;
    if (!isNew) renderPhotos($('#item-photos'), doc);
    $('#item-photos').hidden = isNew;
    $('#item-dlg').showModal();
  }
  $('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = formValues(e.target, ['minQty', 'weightKg']);
    if (!vals.name) return;
    if (current.isNew) {
      if (st.items.some((i) => norm(i.name) === norm(vals.name))) { toast('Позиция с таким наименованием уже есть'); return; }
      await enqueue({ kind: 'item.create', body: itemBody(vals), view: { ...vals } });
      toast('Позиция создана');
    } else {
      const item = st.items.find((i) => i.key === current.key);
      await enqueue({ kind: 'item.patch', ref: { id: item?.id, name: item?.name }, body: itemBody(vals), view: { ...vals } });
      toast('Сохранено');
    }
    $('#item-dlg').close();
  });

  // ---------- Движение ----------
  let mvCtx = null;
  function openMove(type, item, extra = {}) {
    mvCtx = { type, item: item || null, request: extra.request || null };
    const f = $('#mv-form'); f.reset();
    $('#mv-title').textContent = extra.request ? 'Оприходовать' : MOVE[type].label;
    $('#mv-item').textContent = item ? item.name : (extra.request ? `Заявка: ${extra.request.name}` : '');
    $('#mv-hint').textContent = (extra.request ? 'Приход на склад по заявке; заявка станет «Получено».' : MOVE[type].hint) + (type !== 'in' && item ? ` Свободно сейчас: ${fmtNum(stockOf(item).free)}.` : '');
    $('#mv-item-pick').hidden = !!item || !!extra.request;
    f.elements.itemName.value = extra.request ? extra.request.name : '';
    f.elements.qty.value = extra.request && extra.request.qty != null ? num(extra.request.qty) : '';
    f.elements.ref.value = extra.request ? `заявка №${extra.request.num || ''}`.trim() : '';
    $('#mv-dlg').showModal();
  }
  $('#mv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const qty = num(f.elements.qty.value);
    if (!qty || (mvCtx.type !== 'adjust' && qty < 0)) { toast('Укажите количество'); return; }
    const note = [f.elements.ref.value.trim(), f.elements.note.value.trim()].filter(Boolean).join(' · ') || undefined;

    if (mvCtx.request) {   // оприходование заявки: сервер сам заведёт позицию, если её нет
      const r = mvCtx.request;
      await enqueue({ kind: 'req.receive', key: r.key, qty, itemName: mvCtx.item ? mvCtx.item.name : r.name });
      $('#mv-dlg').close(); if ($('#req-dlg').open) $('#req-dlg').close();
      toast(`Оприходовано: ${fmtNum(qty)}`);
      return;
    }
    let item = mvCtx.item;
    if (!item) {
      const name = f.elements.itemName.value.trim();
      if (!name) { toast('Укажите позицию склада'); return; }
      item = st.items.find((i) => norm(i.name) === norm(name));
      if (!item) { await enqueue({ kind: 'item.create', body: { name }, view: { name } }); item = st.items.find((i) => norm(i.name) === norm(name)); }
    }
    if (['out', 'reserve'].includes(mvCtx.type) && qty > stockOf(item).free + 1e-9) {
      toast(`Свободно только ${fmtNum(stockOf(item).free)} — сервер не проведёт больше`); return;
    }
    await enqueue({ kind: 'item.move', ref: { id: item.id, name: item.name }, type: mvCtx.type, qty, note });
    $('#mv-dlg').close();
    toast(`${MOVE[mvCtx.type].label}: ${fmtNum(qty)} проведено`);
    if ($('#item-dlg').open) renderItemStats(item);
  });

  // ---------- Рендер, навигация, вход ----------
  function render() { if (st.view === 'supply') renderSupply(); else renderStock(); }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    st.view = t.dataset.view;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#view-supply').hidden = st.view !== 'supply'; $('#view-stock').hidden = st.view !== 'stock';
    render();
  }));
  const bindFilter = (id, obj, key, ev = 'change') => $(id).addEventListener(ev, (e) => { obj[key] = e.target.value; obj.shown = PAGE; render(); });
  bindFilter('#s-search', sFilter, 'q', 'input'); bindFilter('#s-cat', sFilter, 'cat'); bindFilter('#s-sup', sFilter, 'sup');
  bindFilter('#s-who', sFilter, 'who'); bindFilter('#s-co', sFilter, 'co');
  bindFilter('#w-search', wFilter, 'q', 'input'); bindFilter('#w-cat', wFilter, 'cat');
  $('#s-more').onclick = () => { sFilter.shown += PAGE; render(); };
  $('#w-more').onclick = () => { wFilter.shown += PAGE; render(); };
  $('#s-add').onclick = () => openRequest(null);
  $('#w-add').onclick = () => openItem(null);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('close', () => { if (d.id !== 'mv-dlg') current = null; }));

  function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; }
  async function showApp() {
    $('#login-view').hidden = true; $('#app-view').hidden = false;
    const u = S.user; $('#user-btn').textContent = 'Выйти'; $('#user-btn').title = (u?.displayName || u?.username || '') + ' — выйти';
    await loadCache(); render(); updateNet();
    flush();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error'); err.hidden = true;
    try {
      const res = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#login-username').value.trim(), password: $('#login-password').value }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? 'Неверный логин или пароль' : res.status === 429 ? 'Слишком много попыток, подождите минуту' : j.message || 'Ошибка входа');
      S.access = j.access; S.refresh = j.refresh; S.user = j.user;
      $('#login-password').value = '';
      showApp();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#user-btn').onclick = async () => {
    const q = (await idb.queue()).length;
    if (q && !confirm(`В очереди ${q} неотправленных изменений — они отправятся после следующего входа. Выйти?`)) return;
    S.access = ''; S.refresh = ''; S.user = null; showLogin();
  };
  window.addEventListener('online', () => { st.online = true; updateNet(); flush(); });
  window.addEventListener('offline', () => { st.online = false; updateNet(); });
  setInterval(() => { if (S.refresh) flush(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайна */ });

  if (S.refresh) showApp(); else showLogin();
})();
