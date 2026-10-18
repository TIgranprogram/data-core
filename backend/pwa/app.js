/* «Снабжение / Склад» — PWA на единой базе Data Core (без сборки, vanilla JS).
 * Данные: /api/apps/supply/requests, /api/apps/warehouse/items, /api/apps/warehouse/movements.
 * Офлайн: данные кэшируются в IndexedDB, изменения копятся в очереди (outbox) и досылаются.
 * Без дублей: у каждой записи свой uid; перед повторной отправкой «создания» очередь
 * проверяет, нет ли уже записи с этим uid (обрыв связи после успешного POST).
 * Остатки склада считаются из движений (приход/бронь/списание…), а не вписываются руками.
 */
(() => {
  'use strict';
  // ---------- Константы ----------
  const PREFIX = location.pathname.replace(/\/app(\/.*)?$/, '');       // '' или '/db'
  const API = PREFIX + '/api';
  const COLL = { requests: '/apps/supply/requests', items: '/apps/warehouse/items', movements: '/apps/warehouse/movements' };
  const STATUSES = ['✅ Заказать', '⏳ Ожидает', '💰 Оплачено', '⚙️ В работе', '☑️ Получено', '❌ Отменено'];
  const STATUS_CLASS = { 'Заказать': 'b-order', 'Ожидает': 'b-wait', 'Оплачено': 'b-paid', 'В работе': 'b-work', 'Получено': 'b-done', 'Отменено': 'b-cancel' };
  const PRIORITIES = ['Срочно', 'Обычно', 'Низко'];
  const COMPANIES = ['СИЮ', 'ССЮ'];
  const CATEGORIES = ['Оборудование', 'Покупные изделия', 'Металл', 'Дерево', 'Метизы', 'Расходники', 'Услуги'];
  const MOVE = {
    in: { label: 'Приход', sign: 1, hint: 'Поступление на склад.' },
    reserve: { label: 'Бронь', sign: 0, hint: 'Резерв под заказ: остаток не меняется, «свободно» уменьшается.' },
    unreserve: { label: 'Снять бронь', sign: 0, hint: 'Возврат резерва в свободный остаток.' },
    out: { label: 'Списание', sign: -1, hint: 'Выдача в производство / расход.' },
    adjust: { label: 'Корректировка', sign: 1, hint: 'Инвентаризация: «+» — излишек, «−» — недостача.' },
    opening: { label: 'Начальный остаток', sign: 1, hint: '' },
  };
  const PAGE = 100;

  // ---------- Утилиты ----------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (s) => { if (!s) return ''; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(s); };
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const fmtNum = (n) => (Math.round(n * 1000) / 1000).toLocaleString('ru-RU');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const statusWord = (s) => String(s || '').replace(/^[^\p{L}]+/u, '').trim();
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 3500); }

  // ---------- Сессия ----------
  const S = {
    get access() { return localStorage.getItem('dca_access') || ''; }, set access(v) { v ? localStorage.setItem('dca_access', v) : localStorage.removeItem('dca_access'); },
    get refresh() { return localStorage.getItem('dca_refresh') || ''; }, set refresh(v) { v ? localStorage.setItem('dca_refresh', v) : localStorage.removeItem('dca_refresh'); },
    get user() { try { return JSON.parse(localStorage.getItem('dca_user') || 'null'); } catch { return null; } },
    set user(v) { v ? localStorage.setItem('dca_user', JSON.stringify(v)) : localStorage.removeItem('dca_user'); },
  };
  class NetError extends Error {}
  class AuthError extends Error {}

  async function rawFetch(path, opts, token) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Таймаут: на плохой связи запрос не должен висеть бесконечно (загрузка фото — дольше)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.body instanceof FormData ? 120000 : 15000);
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

  // ---------- Состояние ----------
  const st = { requests: [], items: [], movements: [], queue: [], online: navigator.onLine, syncing: false, view: 'supply' };
  const sFilter = { q: '', status: '', cat: '', sup: '', who: '', co: '', shown: PAGE };
  const wFilter = { q: '', mode: '', cat: '', shown: PAGE };

  async function loadAll(coll) {
    const out = [];
    for (let page = 1; page < 200; page++) {
      const r = await api(`${COLL[coll]}?limit=200&page=${page}&sort=-createdAt`);
      out.push(...r.items);
      if (out.length >= r.total || !r.items.length) break;
    }
    return out;
  }
  async function refreshData() {
    const [requests, items, movements] = await Promise.all(['requests', 'items', 'movements'].map(loadAll));
    Object.assign(st, { requests, items, movements });
    await Promise.all(['requests', 'items', 'movements'].map((k) => idb.set(k, st[k])));
    applyQueueLocally();
  }
  async function loadCache() {
    for (const k of ['requests', 'items', 'movements']) st[k] = (await idb.get(k)) || [];
    st.queue = await idb.queue();
    applyQueueLocally();
  }
  // Неотправленные изменения показываем сразу (оптимистично)
  function applyQueueLocally() {
    for (const op of st.queue) {
      if (op.kind === 'create') { if (!st[op.coll].some((d) => d.uid === op.doc.uid)) st[op.coll].unshift({ ...op.doc, _pending: true }); }
      if (op.kind === 'patch') { const d = st[op.coll].find((x) => x.uid === op.uid); if (d) Object.assign(d, op.patch, { _pending: true }); }
      if (op.kind === 'photo') { const d = st[op.coll].find((x) => x.uid === op.uid); if (d) d._pendingPhotos = (d._pendingPhotos || 0) + 1; }
    }
  }

  // ---------- Очередь изменений ----------
  async function enqueue(op) {
    op.at = Date.now();
    await idb.push(op);
    st.queue = await idb.queue();
    applyQueueLocally();
    render(); updateNet();
    flush();
  }
  async function idByUid(coll, uid) {
    const local = st[coll].find((d) => d.uid === uid && d.id && !d._pending);
    if (local) return local.id;
    const r = await api(`${COLL[coll]}?limit=1&filter=${encodeURIComponent(JSON.stringify({ uid }))}`);
    return r.items[0] ? r.items[0].id : null;
  }
  async function runOp(op) {
    if (op.kind === 'create') {
      if (await idByUid(op.coll, op.doc.uid)) return;           // уже создано (повтор после обрыва)
      await api(COLL[op.coll], { method: 'POST', body: JSON.stringify(op.doc) });
    } else if (op.kind === 'patch') {
      const id = await idByUid(op.coll, op.uid);
      if (!id) throw Object.assign(new Error('Запись ещё не создана'), { retry: true });
      await api(`${COLL[op.coll]}/${id}`, { method: 'PATCH', body: JSON.stringify(op.patch) });
    } else if (op.kind === 'photo') {
      const id = await idByUid(op.coll, op.uid);
      if (!id) throw Object.assign(new Error('Запись ещё не создана'), { retry: true });
      const fd = new FormData(); fd.append('file', op.blob, op.name || 'photo.jpg');
      const photo = await api('/photos/upload', { method: 'POST', body: fd });
      const cur = await api(`${COLL[op.coll]}/${id}`);
      const thumb = photo.variants && photo.variants.thumb ? photo.variants.thumb.storageUrl : photo.storageUrl;
      const photos = [...(cur.photos || []), { id: photo.id || photo._id, url: photo.storageUrl, thumb }];
      await api(`${COLL[op.coll]}/${id}`, { method: 'PATCH', body: JSON.stringify({ photos }) });
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

  // ---------- Остатки склада ----------
  function stockOf(item) {
    const mv = st.movements.filter((m) => m.itemUid === item.uid);
    if (!item.fromMovements && !mv.length) {
      // Позиция из Google-таблицы до перехода: показываем табличные цифры
      const onHand = num(item.currentQty), reserved = num(item.reservedQty);
      return { onHand, reserved, free: onHand - reserved, moves: mv, legacy: true };
    }
    let onHand = 0, reserved = 0;
    for (const m of mv) {
      const q = num(m.qty);
      if (m.type === 'in' || m.type === 'opening' || m.type === 'adjust') onHand += q;
      else if (m.type === 'out') onHand -= q;
      else if (m.type === 'reserve') reserved += q;
      else if (m.type === 'unreserve') reserved -= q;
    }
    return { onHand, reserved, free: onHand - reserved, moves: mv, legacy: false };
  }
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

  function renderSupply() {
    const all = st.requests.filter((r) => !r.deletedAt);
    // фишки статусов
    const chips = $('#s-chips'); chips.replaceChildren();
    const counts = {}; all.forEach((r) => { const w = statusWord(r.status) || 'без статуса'; counts[w] = (counts[w] || 0) + 1; });
    const mk = (label, val, n) => { const b = el('button', 'chip' + (sFilter.status === val ? ' active' : ''), n != null ? `${label} ${n}` : label); b.onclick = () => { sFilter.status = sFilter.status === val ? '' : val; sFilter.shown = PAGE; render(); }; chips.append(b); };
    mk('Все', '', all.length);
    STATUSES.map(statusWord).forEach((w) => { if (counts[w]) mk(w, w, counts[w]); });
    fillSelect($('#s-cat'), uniq([...CATEGORIES, ...all.map((r) => r.category)]), 'Все категории', sFilter.cat);
    fillSelect($('#s-sup'), uniq(all.map((r) => r.supplier)), 'Все поставщики', sFilter.sup);
    fillSelect($('#s-who'), uniq(all.map((r) => r.requestedBy)), 'Кто подал: все', sFilter.who);
    fillSelect($('#s-co'), uniq([...COMPANIES, ...all.map((r) => r.ourCompany)]), 'Все компании', sFilter.co);
    $('#suppliers').replaceChildren(...uniq(all.map((r) => r.supplier)).map((v) => { const o = el('option'); o.value = v; return o; }));

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
      li.append(thumbOf(r));
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
  function renderPhotos(box, doc, coll) {
    box.replaceChildren();
    (doc.photos || []).forEach((p) => { const img = el('img'); img.src = PREFIX + (p.thumb || p.url); img.alt = ''; img.onclick = () => window.open(PREFIX + p.url, '_blank'); box.append(img); });
    if (doc._pendingPhotos) box.append(el('span', 'muted small', `⏳ фото в очереди: ${doc._pendingPhotos}`));
    const add = el('button', 'add', '+ Фото'); add.type = 'button';
    add.onclick = () => pickPhoto(coll, doc);
    box.append(add);
  }
  function pickPhoto(coll, doc) {
    const inp = $('#photo-input');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 10 * 1024 * 1024) { toast('Фото больше 10 МБ'); return; }
      await enqueue({ kind: 'photo', coll, uid: doc.uid, blob: f, name: f.name });
      toast(navigator.onLine ? 'Фото загружается…' : 'Фото сохранено и отправится при появлении связи');
      reopenCurrent();
    };
    inp.click();
  }

  let current = null; // { type: 'req'|'item', uid }
  function reopenCurrent() {
    if (!current) return;
    const coll = current.type === 'req' ? 'requests' : 'items';
    const doc = st[coll].find((d) => d.uid === current.uid);
    if (!doc) return;
    if (current.type === 'req') renderPhotos($('#req-photos'), doc, 'requests');
    else { renderPhotos($('#item-photos'), doc, 'items'); renderItemStats(doc); }
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

  function openRequest(r) {
    const f = $('#req-form');
    fillSelect(f.elements.category, CATEGORIES, '—', ''); fillSelect(f.elements.status, STATUSES, '—', '');
    fillSelect(f.elements.priority, PRIORITIES, '—', ''); fillSelect(f.elements.ourCompany, COMPANIES, '—', '');
    const isNew = !r;
    const doc = r || { uid: uuid(), status: STATUSES[0], priority: 'Обычно', unit: 'шт', ourCompany: COMPANIES[0], date: today(), requestedBy: S.user?.displayName || S.user?.username };
    current = { type: 'req', uid: doc.uid, isNew };
    setFormValues(f, doc);
    // значение не из списка (старые данные) — добавим, чтобы не потерять
    for (const k of ['category', 'status', 'priority', 'ourCompany']) if (doc[k] && f.elements[k].value !== doc[k]) { const o = el('option', '', doc[k]); o.value = doc[k]; f.elements[k].append(o); f.elements[k].value = doc[k]; }
    $('#req-title').textContent = isNew ? 'Новая заявка' : `Заявка${doc.num ? ' №' + doc.num : ''}`;
    $('#req-meta').textContent = isNew ? '' : [doc.requestedBy && `Подал: ${doc.requestedBy}`, doc.date && `дата ${fmtDate(doc.date)}`, doc.receivedAt && `оприходовано ${fmtDate(doc.receivedAt)}`].filter(Boolean).join(' · ');
    renderPhotos($('#req-photos'), doc, 'requests');
    $('#req-photos').hidden = isNew;
    $('#req-receive').hidden = isNew || !!doc.receivedAt;
    $('#req-dlg').showModal();
  }
  $('#req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = formValues(e.target, ['qty', 'priceWithVat']);
    if (!vals.name) return;
    if (current.isNew) {
      const maxNum = st.requests.reduce((m, r) => Math.max(m, num(r.num)), 0);
      const doc = Object.fromEntries(Object.entries({ ...vals, uid: current.uid, num: maxNum + 1, date: today(), requestedBy: S.user?.displayName || S.user?.username }).filter(([, v]) => v != null));
      await enqueue({ kind: 'create', coll: 'requests', doc });
      toast('Заявка создана');
    } else {
      await enqueue({ kind: 'patch', coll: 'requests', uid: current.uid, patch: vals });
      toast('Сохранено');
    }
    $('#req-dlg').close();
  });
  $('#req-receive').addEventListener('click', () => {
    const r = st.requests.find((d) => d.uid === current.uid);
    const match = st.items.find((i) => norm(i.name) === norm(r.name));
    openMove('in', match || null, { request: r });
  });

  // ---------- Склад ----------
  function renderStock() {
    const items = st.items.filter((i) => !i.deletedAt);
    const withStock = items.map((i) => ({ i, s: stockOf(i) }));
    const low = withStock.filter(({ i, s }) => stockBadge(i, s)[0] !== 'в норме');
    const chips = $('#w-chips'); chips.replaceChildren();
    const mk = (label, val, n) => { const b = el('button', 'chip' + (wFilter.mode === val ? ' active' : ''), `${label} ${n}`); b.onclick = () => { wFilter.mode = wFilter.mode === val ? '' : val; wFilter.shown = PAGE; render(); }; chips.append(b); };
    mk('Все', '', items.length);
    mk('К закупке / нет', 'low', low.length);
    mk('В брони', 'res', withStock.filter(({ s }) => s.reserved > 0).length);
    fillSelect($('#w-cat'), uniq([...CATEGORIES, ...items.map((i) => i.category)]), 'Все категории', wFilter.cat);
    $('#items-list').replaceChildren(...items.map((i) => { const o = el('option'); o.value = i.name; return o; }));

    const q = norm(wFilter.q);
    const list = withStock.filter(({ i, s }) =>
      (!wFilter.cat || i.category === wFilter.cat) &&
      (wFilter.mode !== 'low' || stockBadge(i, s)[0] !== 'в норме') && (wFilter.mode !== 'res' || s.reserved > 0) &&
      (!q || norm([i.name, i.article, i.category, i.location].join(' ')).includes(q)))
      .sort((a, b) => String(a.i.name).localeCompare(String(b.i.name), 'ru'));
    $('#w-count').textContent = `Позиций: ${list.length}`;
    const ul = $('#w-list'); ul.replaceChildren();
    list.slice(0, wFilter.shown).forEach(({ i, s }) => {
      const li = el('li', 'row');
      li.append(thumbOf(i));
      const main = el('div', 'row-main');
      main.append(el('div', 'row-title', i.name || '—'));
      main.append(el('div', 'row-sub', [i.category, i.unit, i.location, s.reserved > 0 ? `бронь ${fmtNum(s.reserved)}` : ''].filter(Boolean).join(' · ')));
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

  function renderItemStats(item) {
    const s = stockOf(item);
    const box = $('#item-stats'); box.replaceChildren();
    [['Остаток', s.onHand], ['В брони', s.reserved], ['Свободно', s.free]].forEach(([l, v]) => { const d = el('div', 'stat', l); d.prepend(el('b', '', fmtNum(v))); box.append(d); });
    if (s.legacy) box.append(el('p', 'muted small wide', 'Цифры из Google-таблицы (до перехода на приложение).'));
    const ul = $('#item-moves'); ul.replaceChildren();
    const mv = [...s.moves].sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)));
    if (!mv.length) ul.append(el('li', 'muted', 'Движений пока нет'));
    mv.slice(0, 100).forEach((m) => {
      const sign = m.type === 'out' ? '−' : (m.type === 'in' || m.type === 'opening' || (m.type === 'adjust' && num(m.qty) >= 0)) ? '+' : '';
      ul.append(el('li', '', [fmtDate(m.date), (MOVE[m.type] || {}).label || m.type, `${sign}${fmtNum(Math.abs(num(m.qty)))}`, m.ref, m.note, m.byName, m._pending ? '⏳' : ''].filter(Boolean).join(' · ')));
    });
  }
  function openItem(i) {
    const f = $('#item-form');
    fillSelect(f.elements.category, CATEGORIES, '—', '');
    const isNew = !i;
    const doc = i || { uid: uuid(), unit: 'шт', fromMovements: true };
    current = { type: 'item', uid: doc.uid, isNew };
    setFormValues(f, doc);
    if (doc.category && f.elements.category.value !== doc.category) { const o = el('option', '', doc.category); o.value = doc.category; f.elements.category.append(o); f.elements.category.value = doc.category; }
    $('#item-title').textContent = isNew ? 'Новая позиция' : doc.name;
    const acts = $('#item-actions'); acts.replaceChildren();
    if (!isNew) {
      ['in', 'reserve', 'unreserve', 'out', 'adjust'].forEach((t) => { const b = el('button', 'btn', MOVE[t].label); b.type = 'button'; b.onclick = () => openMove(t, doc); acts.append(b); });
      const toReq = el('button', 'btn', 'В заявку'); toReq.type = 'button';
      toReq.onclick = () => { $('#item-dlg').close(); openRequest(null); const rf = $('#req-form'); rf.elements.name.value = doc.name || ''; rf.elements.unit.value = doc.unit || 'шт'; rf.elements.article.value = doc.article || ''; if (doc.category) rf.elements.category.value = doc.category; };
      acts.append(toReq);
      renderItemStats(doc);
    } else { $('#item-stats').replaceChildren(); $('#item-moves').replaceChildren(); }
    $('#item-stats').hidden = isNew; $('#item-moves').hidden = isNew; acts.hidden = isNew;
    renderPhotos($('#item-photos'), doc, 'items');
    $('#item-photos').hidden = isNew;
    $('#item-dlg').showModal();
  }
  $('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = formValues(e.target, ['minQty', 'weightKg']);
    if (!vals.name) return;
    if (current.isNew) {
      if (st.items.some((i) => !i.deletedAt && norm(i.name) === norm(vals.name))) { toast('Позиция с таким наименованием уже есть'); return; }
      const doc = Object.fromEntries(Object.entries({ ...vals, uid: current.uid, fromMovements: true }).filter(([, v]) => v != null));
      await enqueue({ kind: 'create', coll: 'items', doc });
      toast('Позиция создана');
    } else {
      await enqueue({ kind: 'patch', coll: 'items', uid: current.uid, patch: vals });
      toast('Сохранено');
    }
    $('#item-dlg').close();
  });

  // ---------- Движение ----------
  let mvCtx = null;
  function openMove(type, item, extra = {}) {
    mvCtx = { type, itemUid: item ? item.uid : null, request: extra.request || null };
    const f = $('#mv-form'); f.reset();
    $('#mv-title').textContent = MOVE[type].label;
    $('#mv-item').textContent = item ? item.name : (extra.request ? `Заявка: ${extra.request.name}` : '');
    $('#mv-hint').textContent = MOVE[type].hint + (type !== 'in' && item ? ` Свободно сейчас: ${fmtNum(stockOf(item).free)}.` : '');
    $('#mv-item-pick').hidden = !!item;
    f.elements.itemName.value = extra.request ? extra.request.name : '';
    f.elements.qty.value = extra.request && extra.request.qty != null ? num(extra.request.qty) : '';
    f.elements.date.value = today();
    f.elements.ref.value = extra.request ? `заявка №${extra.request.num || ''}`.trim() : '';
    $('#mv-dlg').showModal();
  }
  $('#mv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const qty = num(f.elements.qty.value);
    if (!qty || (mvCtx.type !== 'adjust' && qty < 0)) { toast('Укажите количество'); return; }
    let itemUid = mvCtx.itemUid;
    if (!itemUid) {
      const name = f.elements.itemName.value.trim();
      if (!name) { toast('Укажите позицию склада'); return; }
      let item = st.items.find((i) => !i.deletedAt && norm(i.name) === norm(name));
      if (!item) {   // новая позиция прямо из заявки
        const r = mvCtx.request || {};
        item = { uid: uuid(), name, category: r.category, unit: r.unit || 'шт', article: r.article, fromMovements: true };
        await enqueue({ kind: 'create', coll: 'items', doc: Object.fromEntries(Object.entries(item).filter(([, v]) => v != null)) });
      }
      itemUid = item.uid;
    }
    const item = st.items.find((i) => i.uid === itemUid);
    if (item && !item.fromMovements) await enqueue({ kind: 'patch', coll: 'items', uid: itemUid, patch: { fromMovements: true } });
    if (['out', 'reserve'].includes(mvCtx.type) && item && qty > stockOf(item).free + 1e-9 && !confirm(`Свободно только ${fmtNum(stockOf(item).free)}. Всё равно провести?`)) return;
    const mv = { uid: uuid(), type: mvCtx.type, itemUid, itemName: item ? item.name : f.elements.itemName.value.trim(), qty,
      date: f.elements.date.value || today(), ref: f.elements.ref.value.trim() || undefined, note: f.elements.note.value.trim() || undefined,
      requestUid: mvCtx.request ? mvCtx.request.uid : undefined, byName: S.user?.displayName || S.user?.username };
    await enqueue({ kind: 'create', coll: 'movements', doc: Object.fromEntries(Object.entries(mv).filter(([, v]) => v !== undefined)) });
    if (mvCtx.request) await enqueue({ kind: 'patch', coll: 'requests', uid: mvCtx.request.uid, patch: { receivedAt: mv.date, itemUid, status: STATUSES[4] } });
    $('#mv-dlg').close();
    if ($('#req-dlg').open) $('#req-dlg').close();
    toast(`${MOVE[mvCtx.type].label}: ${fmtNum(qty)} проведено`);
    if ($('#item-dlg').open && item) renderItemStats(st.items.find((i) => i.uid === itemUid) || item);
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
