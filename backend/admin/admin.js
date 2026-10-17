/* Data Core — статическая админка (без сборки, vanilla JS).
 * Один файл, ходит в тот же origin на /api. JWT живёт в sessionStorage.
 */
(() => {
  const API = '/api';
  const store = {
    get token() { return sessionStorage.getItem('dc_token') || ''; },
    set token(v) { v ? sessionStorage.setItem('dc_token', v) : sessionStorage.removeItem('dc_token'); },
    get user() { try { return JSON.parse(sessionStorage.getItem('dc_user') || 'null'); } catch { return null; } },
    set user(v) { v ? sessionStorage.setItem('dc_user', JSON.stringify(v)) : sessionStorage.removeItem('dc_user'); },
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  // ---- HTTP helper: attach JWT, auto-logout on 401 ----
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (store.token) headers.Authorization = `Bearer ${store.token}`;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { ...opts, headers });
    if (res.status === 401 && store.token) { logout(); throw new Error('Сессия истекла — войдите снова'); }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.message || j.error || msg; if (Array.isArray(msg)) msg = msg.join('; '); } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  // ---- Auth ----
  async function login(username, password) {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    store.token = r.access;
    store.user = r.user;
  }
  function logout() { store.token = ''; store.user = null; }

  // ---- View switching ----
  function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    const u = store.user;
    $('#whoami').textContent = u ? `${u.username} · ${u.role}` : '';
    loadUsers(); refreshHealth();
  }
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
  }

  async function refreshHealth() {
    const b = $('#health-badge');
    try { await api('/health/ready'); b.textContent = 'API OK'; b.className = 'badge ok'; }
    catch { b.textContent = 'API недоступен'; b.className = 'badge bad'; }
  }

  // ---- Tabs ----
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${t.dataset.tab}`; });
    if (t.dataset.tab === 'keys') loadKeys();
    if (t.dataset.tab === 'tables') loadCollections();
  }));

  // ---- Users ----
  const userState = { page: 1, limit: 20, search: '', role: '' };
  async function loadUsers() {
    const tbody = $('#users-table tbody'); tbody.replaceChildren();
    const q = new URLSearchParams({ page: userState.page, limit: userState.limit });
    if (userState.search) q.set('search', userState.search);
    if (userState.role) q.set('role', userState.role);
    try {
      const r = await api('/admin/users?' + q);
      (r.items || []).forEach((u) => tbody.append(userRow(u)));
      const pages = Math.max(1, Math.ceil((r.total || 0) / userState.limit));
      $('#users-page').textContent = `стр. ${userState.page} / ${pages} · всего ${r.total || 0}`;
      $('#users-prev').disabled = userState.page <= 1;
      $('#users-next').disabled = userState.page >= pages;
    } catch (e) { toast(e.message); }
  }
  /**
   * API отдаёт пользователей и ключи с полем `id` (mongoose virtual), НЕ `_id`.
   * Раньше здесь читался только `u._id`, из-за чего «Изменить» теряла id
   * (диалог уходил в создание нового), а «Сброс пароля» и «Удалить» шли на
   * /admin/users/undefined → CastError → 500.
   */
  function userId(u) { return (u && (u.id || u._id)) || ''; }

  function userRow(u) {
    const tr = el('tr');
    tr.append(el('td', '', u.username), el('td', '', u.displayName || '—'), el('td', '', u.email || '—'),
      el('td', '', u.role), el('td', '', u.isActive ? 'да' : 'нет'), el('td', '', fmtDate(u.createdAt)));
    const td = el('td');
    const edit = el('button', 'btn btn-sm', 'Изменить'); edit.onclick = () => openUserDialog(u);
    const reset = el('button', 'btn btn-sm', 'Сброс пароля'); reset.onclick = () => resetPassword(u);
    const del = el('button', 'btn btn-sm btn-danger', 'Удалить'); del.onclick = () => deleteUser(u);
    td.append(edit, reset, del); tr.append(td);
    return tr;
  }
  function openUserDialog(u) {
    $('#user-dialog-title').textContent = u ? 'Изменить пользователя' : 'Новый пользователь';
    $('#user-id').value = userId(u);
    $('#f-username').value = u?.username || '';
    $('#f-displayName').value = u?.displayName || '';
    $('#f-email').value = u?.email || '';
    $('#f-role').value = u?.role || 'user';
    $('#f-password').value = '';
    $('#f-password-wrap').hidden = !!u; // пароль только при создании
    $('#f-username').disabled = !!u;    // логин не меняем
    $('#user-form-error').hidden = true;
    $('#user-dialog').showModal();
  }
  async function saveUser(ev) {
    ev.preventDefault();
    const id = $('#user-id').value;
    const body = { displayName: $('#f-displayName').value || undefined, email: $('#f-email').value || undefined, role: $('#f-role').value };
    try {
      if (id) { await api('/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(body) }); }
      else {
        body.username = $('#f-username').value;
        body.password = $('#f-password').value;
        await api('/admin/users', { method: 'POST', body: JSON.stringify(body) });
      }
      $('#user-dialog').close(); loadUsers();
    } catch (e) { const p = $('#user-form-error'); p.textContent = e.message; p.hidden = false; }
  }
  async function resetPassword(u) {
    const pw = prompt(`Новый пароль для «${u.username}»:`);
    if (!pw) return;
    try { await api(`/admin/users/${userId(u)}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: pw }) }); toast('Пароль изменён'); }
    catch (e) { toast(e.message); }
  }
  async function deleteUser(u) {
    if (!confirm(`Удалить пользователя «${u.username}»?`)) return;
    try { await api('/admin/users/' + userId(u), { method: 'DELETE' }); loadUsers(); }
    catch (e) { toast(e.message); }
  }

  // ---- API keys ----
  async function loadKeys() {
    const tbody = $('#keys-table tbody'); tbody.replaceChildren();
    try {
      const list = await api('/desktop/pairing-keys');
      if (!list || !list.length) { const tr = el('tr'); const td = el('td', 'muted', 'Ключей нет'); td.colSpan = 6; tr.append(td); tbody.append(tr); return; }
      list.forEach((k) => tbody.append(keyRow(k)));
    } catch (e) { toast(e.message); }
  }
  function keyRow(k) {
    const tr = el('tr');
    tr.append(el('td', '', k.label || k.tokenPrefix || '—'), el('td', '', k.ttl || '—'),
      el('td', '', fmtDate(k.createdAt)), el('td', '', k.revokedAt ? fmtDate(k.revokedAt) : '—'),
      el('td', '', fmtDate(k.lastUsedAt)));
    const td = el('td');
    if (!k.revokedAt) { const rv = el('button', 'btn btn-sm btn-danger', 'Отозвать'); rv.onclick = () => revokeKey(k); td.append(rv); }
    tr.append(td);
    return tr;
  }
  async function revokeKey(k) {
    if (!confirm(`Отозвать ключ «${k.label || k.tokenPrefix}»?`)) return;
    try { await api(`/desktop/pairing-keys/${k._id || k.id}/revoke`, { method: 'POST' }); loadKeys(); }
    catch (e) { toast(e.message); }
  }
  function openKeyDialog() {
    $('#k-label').value = ''; $('#k-ttl').value = '30d';
    $('#k-apiBaseUrl').value = location.origin;
    $('#key-form-error').hidden = true;
    $('#key-dialog').showModal();
  }
  async function createKey(ev) {
    ev.preventDefault();
    try {
      const r = await api('/desktop/pairing-keys', { method: 'POST', body: JSON.stringify({
        label: $('#k-label').value, ttl: $('#k-ttl').value, apiBaseUrl: $('#k-apiBaseUrl').value,
      })});
      $('#key-dialog').close();
      $('#key-shown-value').textContent = r.apiKey;
      $('#key-shown-dialog').showModal();
      loadKeys();
    } catch (e) { const p = $('#key-form-error'); p.textContent = e.message; p.hidden = false; }
  }

  // ---- Tables (справочник коллекций) ----
  const colState = { items: [], categories: [], search: '', cache: new Map() };
  /** Русские подписи типов таблиц (бейдж рядом с именем). */
  const KIND_LABEL = { core: 'действующая', link: 'связевая', legacy: 'остаток' };

  async function loadCollections(force = false) {
    const tbody = $('#cols-table tbody');
    if (!force && colState.items.length) { renderCollections(); return; }
    tbody.replaceChildren();
    const ph = el('tr'); const ptd = el('td', 'muted', 'Загрузка…'); ptd.colSpan = 6; ph.append(ptd); tbody.append(ph);
    try {
      const r = await api('/admin/collections');
      colState.items = r.items || [];
      colState.categories = r.categories || [];
      renderCollections();
      renderTablesSummary();
    } catch (e) { tbody.replaceChildren(); toast(e.message); }
  }

  /** Легенда над таблицей: всего + разбивка по типам (оставить / удалить). */
  function renderTablesSummary() {
    const wrap = $('#tables-summary'); if (!wrap) return;
    const counts = { core: 0, link: 0, legacy: 0 };
    colState.items.forEach((c) => { counts[c.kind] = (counts[c.kind] || 0) + 1; });

    wrap.replaceChildren();
    const total = el('span', 'sum-pill sum-total');
    total.append(el('b', '', String(colState.items.length)), el('span', '', 'таблиц всего'));
    wrap.append(total);

    const pill = (kind, label) => {
      const p = el('span', 'sum-pill k-' + kind);
      p.append(el('i', 'dot'), el('b', '', String(counts[kind] || 0)), el('span', '', label));
      wrap.append(p);
    };
    pill('core', 'действующих');
    pill('link', 'связевых');
    pill('legacy', 'остатков (можно удалить)');

    wrap.append(el('span', 'sum-hint',
      'действующая — есть модуль-код · связевая — вложена в основные таблицы · остаток — код удалён при чистке H'));
  }

  function renderCollections() {
    const tbody = $('#cols-table tbody'); tbody.replaceChildren();
    const s = colState.search.toLowerCase();
    const items = colState.items.filter((c) =>
      !s || c.name.toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s));
    $('#cols-summary').textContent = items.length
      ? `${items.length} из ${colState.items.length} · записей суммарно ${items.reduce((a, c) => a + c.count, 0).toLocaleString('ru-RU')}`
      : '';
    if (!items.length) {
      const tr = el('tr'); const td = el('td', 'muted', 'Ничего не найдено'); td.colSpan = 6; tr.append(td); tbody.append(tr);
      return;
    }

    // Группировка по категориям (порядок — из ответа API); категории без
    // совпадений пропускаются, чтобы поиск работал по всему списку.
    const byCat = new Map();
    items.forEach((c) => {
      const id = c.category || 'unknown';
      if (!byCat.has(id)) byCat.set(id, []);
      byCat.get(id).push(c);
    });
    const ordered = colState.categories.filter((cat) => byCat.has(cat.id));
    byCat.forEach((_, id) => { if (!ordered.some((c) => c.id === id)) ordered.push({ id, label: id }); });

    ordered.forEach((cat) => {
      const rows = byCat.get(cat.id).slice().sort((a, b) => a.name.localeCompare(b.name));
      tbody.append(catRow(cat, rows.length));
      rows.forEach((c) => {
        const main = colRow(c), detail = detailRow();
        main.addEventListener('click', () => toggleCol(c, main, detail));
        tbody.append(main, detail);
      });
    });
  }

  /** Строка-заголовок категории (на всю ширину таблицы). */
  function catRow(cat, n) {
    const tr = el('tr', 'cat-row' + (cat.legacy ? ' legacy' : ''));
    const td = el('td'); td.colSpan = 6;
    td.append(el('span', 'cat-label', cat.label), el('span', 'cat-count', String(n)));
    tr.append(td);
    return tr;
  }

  function colRow(c) {
    const tr = el('tr', 'col-row');
    tr.append(el('td', 'col-caret', '▸'));

    const nameTd = el('td');
    nameTd.append(el('span', 'col-name', c.name));
    const kind = c.kind || 'core';
    nameTd.append(el('span', 'kind kind-' + kind, KIND_LABEL[kind] || kind));
    tr.append(nameTd);

    // Русское описание — сразу после имени (основная колонка для чтения).
    const doc = el('td', 'col-doc', c.description || '—');
    if (!c.description) doc.classList.add('muted');
    tr.append(doc);

    tr.append(el('td', 'num', c.count.toLocaleString('ru-RU')));
    tr.append(el('td', 'num', String(c.fieldCount)));
    tr.append(el('td', 'muted small', (c.keyFields || []).map((f) => f.name).join(', ') || '—'));
    return tr;
  }

  function detailRow() {
    const tr = el('tr', 'col-detail'); tr.hidden = true;
    const td = el('td', 'col-detail-cell'); td.colSpan = 6;
    tr.append(td);
    return tr;
  }

  async function toggleCol(c, main, detail) {
    const caret = main.querySelector('.col-caret');
    if (!detail.hidden) { detail.hidden = true; main.classList.remove('open'); caret.textContent = '▸'; return; }
    main.classList.add('open'); caret.textContent = '▾';

    const td = detail.querySelector('.col-detail-cell');
    const cached = colState.cache.get(c.name);
    if (cached) { renderColDetail(td, cached); detail.hidden = false; return; }

    td.replaceChildren(el('p', 'muted', 'Загрузка полей…'));
    detail.hidden = false;
    try {
      const d = await api('/admin/collections/' + encodeURIComponent(c.name) + '?sample=200');
      colState.cache.set(c.name, d);
      renderColDetail(td, d);
    } catch (e) {
      td.replaceChildren(el('p', 'error', 'Ошибка: ' + e.message));
    }
  }

  function renderColDetail(td, d) {
    td.replaceChildren();
    if (d.description) {
      const p = el('p', 'col-desc');
      p.append(document.createTextNode(d.description));
      const kind = d.kind || 'core';
      p.append(el('span', 'kind kind-' + kind, KIND_LABEL[kind] || kind));
      td.append(p);
    }
    td.append(el('p', 'muted small',
      `Записей: ${d.count.toLocaleString('ru-RU')} · проанализировано семпла: ${d.sampled}` +
      (d.truncated ? ' · показаны первые 400 полей' : '')));

    // Зона удаления — только для остатков. Backend дополнительно не пустит
    // ни действующие, ни связевые таблицы, ни неизвестные имена.
    if (d.kind === 'legacy') {
      const bar = el('div', 'danger-zone');
      const btn = el('button', 'btn btn-danger', `Удалить коллекцию «${d.name}»`);
      btn.type = 'button';
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); dropCollection(d); });
      bar.append(btn, el('span', 'danger-note',
        'Необратимо: коллекция исчезнет вместе с записями. Действующие и связевые таблицы удалить нельзя.'));
      td.append(bar);
    }

    const wrap = el('div', 'table-wrap sub-wrap');
    const t = el('table', 'table sub-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Поле', 'Тип', 'Заполненность', 'Пример'].forEach((h) => hr.append(el('th', '', h)));
    thead.append(hr); t.append(thead);
    const tb = el('tbody');
    (d.fields || []).forEach((f) => {
      const tr = el('tr');
      tr.append(el('td', '', f.path));
      const typeTd = el('td');
      typeTd.append(el('span', 'type-pill', f.types.join(' | ')));
      tr.append(typeTd);
      const barTd = el('td');
      const pct = Math.round(f.completeness * 100);
      const bar = el('div', 'bar');
      const fill = el('i'); fill.style.width = pct + '%';
      if (pct < 60) fill.classList.add('low');
      bar.append(fill);
      const pctSpan = el('span', 'muted small', ' ' + pct + '%');
      barTd.append(bar, pctSpan);
      tr.append(barTd);
      const ex = f.example === undefined || f.example === null ? '—' : (typeof f.example === 'object' ? JSON.stringify(f.example) : String(f.example));
      tr.append(el('td', 'small example-cell', ex));
      tb.append(tr);
    });
    t.append(tb); wrap.append(t); td.append(wrap);
  }

  /**
   * Удаление коллекции-остатка.
   * Двойная защита от опечатки: ввод имени + проверка на бэке по реестру.
   */
  async function dropCollection(c) {
    const typed = prompt(
      'ВНИМАНИЕ: коллекция будет удалена БЕЗВОЗВРАТНО, вместе с записями.\n\n' +
      `Коллекция: «${c.name}»\n` +
      `Записей:   ${c.count ? c.count.toLocaleString('ru-RU') : 0}\n\n` +
      'Чтобы подтвердить, введите имя коллекции точно (без кавычек):',
      '',
    );
    if (typed === null) return;                      // Esc — отмена
    if (typed.trim() !== c.name) {
      toast('Имя не совпало — удаление отменено.');
      return;
    }
    try {
      const r = await api('/admin/collections/' + encodeURIComponent(c.name), { method: 'DELETE' });
      toast(`Коллекция «${r.name}» удалена (записей: ${r.removedDocuments})`);
      await loadCollections(true);   // перечитывает список и сводку
    } catch (e) { toast(e.message); }
  }

  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = el('div'); t.id = 'toast'; document.body.append(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3500);
  }

  // ---- Wire up ----
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error'); err.hidden = true;
    try { await login($('#login-username').value.trim(), $('#login-password').value); showApp(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#logout-btn').addEventListener('click', () => { logout(); showLogin(); });
  $('#user-create-btn').addEventListener('click', () => openUserDialog(null));
  $('#user-form').addEventListener('submit', saveUser);
  $('#user-cancel').addEventListener('click', () => $('#user-dialog').close());
  $('#user-search-form').addEventListener('submit', (e) => { e.preventDefault(); userState.search = $('#user-search').value.trim(); userState.role = $('#user-role-filter').value; userState.page = 1; loadUsers(); });
  $('#users-prev').addEventListener('click', () => { userState.page = Math.max(1, userState.page - 1); loadUsers(); });
  $('#users-next').addEventListener('click', () => { userState.page += 1; loadUsers(); });
  $('#key-create-btn').addEventListener('click', openKeyDialog);
  $('#key-form').addEventListener('submit', createKey);
  $('#key-cancel').addEventListener('click', () => $('#key-dialog').close());
  $('#key-shown-close').addEventListener('click', () => $('#key-shown-dialog').close());
  $('#key-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#key-shown-value').textContent); toast('Скопировано'); } catch { /* ignore */ } });
  $('#col-search-form').addEventListener('submit', (e) => { e.preventDefault(); colState.search = $('#col-search').value.trim(); renderCollections(); });
  $('#col-refresh').addEventListener('click', () => { colState.cache.clear(); loadCollections(true); });

  // ---- Boot ----
  if (store.token) showApp(); else showLogin();
})();
