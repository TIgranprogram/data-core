/* Data Core — статическая админка (без сборки, vanilla JS).
 * Один файл, ходит в тот же origin на /api. JWT живёт в sessionStorage.
 */
(() => {
  // Админка может жить за префиксом прокси (https://<домен>/db/admin/ → /admin/).
  // PREFIX = всё до «/admin» в текущем пути: '' локально, '/db' за nginx.
  const PREFIX = location.pathname.replace(/\/admin(\/.*)?$/, '');
  const API = PREFIX + '/api';
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
    if (res.status === 401 && store.token) { logout(); showLogin(); throw new Error('Сессия истекла — войдите снова'); }
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
    $('#whoami').textContent = u ? `${u.username} · ${ROLE_RU[u.role] || u.role}${u.isOwner ? ' · владелец' : ''}` : '';
    // Переходы: CRM живёт на корне домена только в публичном контуре (/db/…)
    $('#crm-link').hidden = !PREFIX;
    loadUsers(); refreshHealth();
  }
  const ROLE_RU = { admin: 'администратор', director: 'директор', manager: 'менеджер', user: 'наблюдатель' };
  function initTheme() {
    const b = $('#theme-btn'); if (!b || !window.dcTheme) { if (b) b.hidden = true; return; }
    $('#theme-name').textContent = window.dcTheme.name();
    b.onclick = () => { $('#theme-name').textContent = window.dcTheme.cycle(); };
  }
  initTheme();
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
    if (t.dataset.tab === 'connect') loadConnect();
    if (t.dataset.tab === 'sheets') loadSheets();
    if (t.dataset.tab === 'audit') { auditState.page = 1; loadAudit(); }
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
      el('td', '', ROLE_RU[u.role] || u.role), el('td', '', u.isActive ? 'да' : 'нет'), el('td', '', fmtDate(u.createdAt)));
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
    $('#f-role').value = u?.role || 'manager';

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
      if (!list || !list.length) { const tr = el('tr'); const td = el('td', 'muted', 'Ключей нет'); td.colSpan = 7; tr.append(td); tbody.append(tr); return; }
      list.forEach((k) => tbody.append(keyRow(k)));
    } catch (e) { toast(e.message); }
  }
  /** P2: подпись прав ключа (scope). Нет scope = полный доступ (старые ключи). */
  const ACCESS_LABEL = { read: 'Только чтение', write: 'Чтение и запись', full: 'Полный доступ' };
  function scopeText(scope) {
    const s = scope || { access: 'full' };
    let t = ACCESS_LABEL[s.access] || ACCESS_LABEL.full;
    if (Array.isArray(s.apps) && s.apps.length) t += ' · приложения: ' + s.apps.join(', ');
    return t;
  }
  function parseApps(raw) {
    return [...new Set(String(raw || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))];
  }
  function keyRow(k) {
    const tr = el('tr');
    tr.append(el('td', '', k.label || k.tokenPrefix || '—'), el('td', '', scopeText(k.scope)), el('td', '', k.ttl || '—'),
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
    $('#k-access').value = 'write'; $('#k-apps').value = '';
    $('#k-apiBaseUrl').value = location.origin + PREFIX;
    $('#key-form-error').hidden = true;
    $('#key-dialog').showModal();
  }
  async function createKey(ev) {
    ev.preventDefault();
    try {
      const scope = { access: $('#k-access').value };
      const apps = parseApps($('#k-apps').value);
      if (apps.length) scope.apps = apps;
      const r = await api('/desktop/pairing-keys', { method: 'POST', body: JSON.stringify({
        label: $('#k-label').value, ttl: $('#k-ttl').value, apiBaseUrl: $('#k-apiBaseUrl').value, scope,
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
  const KIND_LABEL = { core: 'действующая', link: 'связевая', crm: 'CRM kppdf', app: 'приложение' };

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
    const counts = { core: 0, link: 0, crm: 0, app: 0 };
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
    pill('app', 'данных приложений');
    pill('crm', 'таблиц CRM kppdf (не удаляются)');

    wrap.append(el('span', 'sum-hint',
      'действующая — есть модуль-код · связевая — вложена в основные таблицы · приложение — данные из /api/apps (можно удалить) · CRM kppdf — таблицы CRM на общей базе (удалять нельзя)'));
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
    const tr = el('tr', 'cat-row' + (cat.crm ? ' legacy' : ''));
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

    // Зона удаления — только для остатков и данных приложений (P1). Backend дополнительно
    // не пустит ни действующие, ни связевые таблицы, ни неизвестные имена.
    if (d.kind === 'app') {
      const bar = el('div', 'danger-zone');
      const btn = el('button', 'btn btn-danger', `Удалить коллекцию «${d.name}»`);
      btn.type = 'button';
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); dropCollection(d); });
      bar.append(btn, el('span', 'danger-note',
        'Необратимо: коллекция исчезнет вместе с записями. Действующие и связевые таблицы удалить нельзя.'));
      td.append(bar);
    }

    // Переключатель: структура полей / сами записи (A2)
    const sw = el('div', 'cx-langs view-switch');
    const bFields = el('button', 'btn btn-sm cx-lang active', 'Поля'); bFields.type = 'button';
    const bDocs = el('button', 'btn btn-sm cx-lang', 'Записи (' + d.count.toLocaleString('ru-RU') + ')'); bDocs.type = 'button';
    sw.append(bFields, bDocs);
    const docsBox = el('div', 'docs-box'); docsBox.hidden = true;
    let docsLoaded = false;
    bFields.addEventListener('click', (ev) => { ev.stopPropagation(); bFields.classList.add('active'); bDocs.classList.remove('active'); wrap.hidden = false; docsBox.hidden = true; });
    bDocs.addEventListener('click', (ev) => {
      ev.stopPropagation(); bDocs.classList.add('active'); bFields.classList.remove('active'); wrap.hidden = true; docsBox.hidden = false;
      if (!docsLoaded) { docsLoaded = true; renderDocsViewer(docsBox, d.name); }
    });
    td.append(sw, docsBox);

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

  // ---- A2: просмотр записей коллекции (только чтение; секреты маскирует сервер) ----
  function shortVal(v) {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return `[${v.length}]`;
    if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 60) + '…' : s; }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const d = new Date(s); if (!isNaN(d)) return d.toLocaleString('ru-RU'); }
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }

  function renderDocsViewer(box, name) {
    const st = { page: 1, limit: 20, deleted: 'exclude', q: '' };
    box.replaceChildren();
    const bar = el('form', 'filters docs-bar');
    const q = el('input'); q.placeholder = 'Поиск: имя, логин, артикул, email… или id';
    const del = el('select');
    [['exclude', 'Без удалённых'], ['include', 'Все'], ['only', 'Только удалённые']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; del.append(o); });
    const go = el('button', 'btn btn-primary', 'Найти'); go.type = 'submit';
    bar.append(q, del, go);
    const info = el('p', 'muted small', '');
    const wrap = el('div', 'table-wrap sub-wrap');
    const pager = el('div', 'pager');
    const prev = el('button', 'btn btn-sm', '← Назад'); prev.type = 'button';
    const pageInfo = el('span', 'muted small', '');
    const next = el('button', 'btn btn-sm', 'Вперёд →'); next.type = 'button';
    pager.append(prev, pageInfo, next);
    box.append(bar, info, wrap, pager);

    async function load() {
      wrap.replaceChildren(el('p', 'muted', 'Загрузка записей…'));
      const qs = new URLSearchParams({ page: st.page, limit: st.limit, deleted: st.deleted });
      if (st.q) qs.set('q', st.q);
      let r;
      try { r = await api('/admin/collections/' + encodeURIComponent(name) + '/docs?' + qs); }
      catch (e) { wrap.replaceChildren(el('p', 'error', 'Ошибка: ' + e.message)); return; }
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      info.textContent = `Найдено: ${r.total.toLocaleString('ru-RU')} · сначала новые · секретные поля скрыты (***) · нажмите строку, чтобы увидеть запись целиком`;
      pageInfo.textContent = ` стр. ${r.page} / ${pages} `;
      prev.disabled = r.page <= 1; next.disabled = r.page >= pages;
      if (!r.items.length) { wrap.replaceChildren(el('p', 'muted', 'Записей нет')); return; }

      // Колонки: _id + самые частые поля страницы (служебные — в конец не берём)
      const freq = new Map();
      r.items.forEach((d) => Object.keys(d).forEach((k) => { if (!['_id', 'id', '__v', 'deletedAt', 'updatedAt'].includes(k)) freq.set(k, (freq.get(k) || 0) + 1); }));
      const prefer = ['name', 'title', 'label', 'username', 'article', 'email', 'status', 'createdAt'];
      const cols = ['_id', ...[...freq.keys()].sort((a, b) => (prefer.indexOf(b) > -1) - (prefer.indexOf(a) > -1) || freq.get(b) - freq.get(a)).slice(0, 6)];

      const t = el('table', 'table sub-table docs-table');
      const hr = el('tr'); cols.forEach((c) => hr.append(el('th', '', c)));
      const thead = el('thead'); thead.append(hr); t.append(thead);
      const tb = el('tbody');
      r.items.forEach((d) => {
        const tr = el('tr', 'doc-row' + (d.deletedAt ? ' doc-deleted' : ''));
        cols.forEach((c) => tr.append(el('td', c === '_id' ? 'mono small' : 'small', shortVal(d[c]))));
        const full = el('tr', 'doc-full'); full.hidden = true;
        const fullTd = el('td'); fullTd.colSpan = cols.length;
        const pre = el('pre', 'cx-code', JSON.stringify(d, null, 2));
        fullTd.append(pre); full.append(fullTd);
        tr.addEventListener('click', () => { full.hidden = !full.hidden; });
        tb.append(tr, full);
      });
      t.append(tb);
      wrap.replaceChildren(t);
    }

    bar.addEventListener('submit', (e) => { e.preventDefault(); st.q = q.value.trim(); st.deleted = del.value; st.page = 1; load(); });
    prev.addEventListener('click', () => { st.page = Math.max(1, st.page - 1); load(); });
    next.addEventListener('click', () => { st.page += 1; load(); });
    load();
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

  // ---- Google-таблицы (сервер читает их сервисным аккаунтом) ----
  async function loadSheets() {
    const list = $('#gs-list');
    try {
      const s = await api('/admin/sheets-sync');
      $('#gs-interval').textContent = s.intervalMin;
      $('#gs-email').textContent = s.serviceEmail || '—';
      $('#gs-key-note').textContent = s.configured
        ? 'Ключ Google установлен на сервере.'
        : (s.keyError ? 'Ошибка ключа: ' + s.keyError : 'Ключ Google ещё не установлен на сервере (secrets/google-sa.json) — синхронизация не работает.');
      list.textContent = '';
      if (!s.items.length) { list.textContent = 'Пока ни одной таблицы.'; return; }
      for (const src of s.items) {
        const card = el('div', 'gs-src');
        const head = el('div', 'cx-row');
        const a = el('a', null, src.title); a.href = 'https://docs.google.com/spreadsheets/d/' + src.spreadsheetId + '/edit'; a.target = '_blank'; a.rel = 'noopener';
        head.append(a, el('span', 'muted small', ' · последняя синхронизация: ' + fmtDate(src.lastRunAt)));
        const del = el('button', 'btn btn-sm', 'Отключить'); del.type = 'button'; del.style.marginLeft = 'auto';
        del.onclick = async () => {
          if (!confirm('Отключить «' + src.title + '»? Уже перенесённые записи останутся в базе.')) return;
          try { await api('/admin/sheets-sync/sources/' + src.id, { method: 'DELETE' }); toast('Отключено'); loadSheets(); } catch (e) { toast(e.message); }
        };
        head.append(del);
        card.append(head);
        if (src.lastError) card.append(el('div', 'small', '❌ ' + src.lastError));
        for (const line of src.lastResult || []) card.append(el('div', 'small', line));
        list.append(card);
      }
    } catch (e) { list.textContent = e.message; }
  }
  $('#gs-add')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('/admin/sheets-sync/sources', { method: 'POST', body: JSON.stringify({ url: $('#gs-url').value.trim() }) });
      $('#gs-url').value = '';
      toast('Подключено: «' + r.title + '»' + (r.sheetsFound.length ? ' — листы: ' + r.sheetsFound.join(', ') : ' — нужных листов не найдено'));
      loadSheets();
    } catch (e) { toast(e.message); }
  });
  $('#gs-run')?.addEventListener('click', async () => {
    const b = $('#gs-run'); b.disabled = true; b.textContent = '⏳ Синхронизация…';
    try {
      const r = await api('/admin/sheets-sync/run', { method: 'POST' });
      toast(r.skipped ? 'Не запущено: ' + r.reason : 'Готово');
    } catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = '🔄 Синхронизировать сейчас';
    loadSheets();
  });

  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = el('div'); t.id = 'toast'; document.body.append(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3500);
  }

  // ---- A3: журнал изменений (/api/audit-logs) ----
  const ACTION_RU = {
    create: 'создание', update: 'изменение', delete: 'удаление', archive: 'в архив', restore: 'восстановление', duplicate: 'копия',
    'drop-collection': 'удаление таблицы', 'add-composition-line': 'состав: добавлена строка', 'update-composition-line': 'состав: изменена строка',
    'remove-composition-line': 'состав: удалена строка', 'admin.user.created': 'создан пользователь', 'admin.user.updated': 'изменён пользователь',
    'admin.user.deleted': 'удалён пользователь', 'admin.user.password_reset': 'сброс пароля', 'admin.user.activated': 'пользователь включён',
    'admin.user.deactivated': 'пользователь отключён', 'admin.user.password-changed': 'смена пароля', login: 'вход', logout: 'выход',
    'admin.role.created': 'создана роль', 'admin.role.updated': 'изменена роль', 'admin.role.deleted': 'удалена роль',
    'admin.permissions.catalog': 'просмотр каталога прав', set_attribute: 'атрибут задан', delete_attribute: 'атрибут удалён',
    reorder: 'порядок изменён', replace: 'замена', put_asset: 'файл загружен', remove_asset: 'файл удалён', clear: 'очистка', clear_all: 'очистка всего',
  };
  const actionRu = (a) => ACTION_RU[a] || a;
  const auditState = { page: 1, limit: 50, facetsLoaded: false };

  async function loadAuditFacets() {
    if (auditState.facetsLoaded) return;
    try {
      const f = await api('/audit-logs/facets');
      const fill = (sel, items, val, label) => items.forEach((it) => { const o = el('option', '', label(it)); o.value = val(it); sel.append(o); });
      fill($('#audit-entity'), f.entityTypes, (x) => x, (x) => x);
      fill($('#audit-action'), f.actions, (x) => x, (x) => actionRu(x) + (ACTION_RU[x] ? ' (' + x + ')' : ''));
      fill($('#audit-user'), f.users, (u) => u.userId, (u) => u.userName);
      auditState.facetsLoaded = true;
    } catch (e) { toast(e.message); }
  }

  async function loadAudit() {
    loadAuditFacets();
    const tbody = $('#audit-table tbody');
    tbody.replaceChildren(el('tr', '', ''));
    tbody.firstChild.append(el('td', 'muted', 'Загрузка…'));
    const qs = new URLSearchParams({ page: auditState.page, limit: auditState.limit });
    const add = (k, v) => { if (v) qs.set(k, v); };
    add('entityType', $('#audit-entity').value); add('action', $('#audit-action').value); add('userId', $('#audit-user').value);
    add('from', $('#audit-from').value); add('to', $('#audit-to').value);
    if (auditState.entityId) qs.set('entityId', auditState.entityId);
    let r;
    try { r = await api('/audit-logs?' + qs); } catch (e) { tbody.replaceChildren(); toast(e.message); return; }
    const pages = Math.max(1, Math.ceil(r.total / r.limit));
    $('#audit-summary').textContent = 'записей: ' + r.total.toLocaleString('ru-RU') + (auditState.entityId ? ' · только запись ' + auditState.entityId : '');
    $('#audit-page').textContent = ' стр. ' + r.page + ' / ' + pages + ' ';
    $('#audit-prev').disabled = r.page <= 1; $('#audit-next').disabled = r.page >= pages;
    tbody.replaceChildren();
    if (!r.items.length) { const tr = el('tr'); const td = el('td', 'muted', 'Записей нет'); td.colSpan = 6; tr.append(td); tbody.append(tr); return; }
    r.items.forEach((it) => {
      const tr = el('tr', 'doc-row');
      tr.append(
        el('td', 'small', it.createdAt ? new Date(it.createdAt).toLocaleString('ru-RU') : '—'),
        el('td', '', it.userName || '—'),
        el('td', '', actionRu(it.action)),
        el('td', '', it.entityType || '—'),
      );
      const idTd = el('td', 'mono small');
      if (it.entityId) {
        const a = el('a', 'link', it.entityId.slice(-8)); a.href = '#'; a.title = 'Показать всю историю этой записи: ' + it.entityId;
        a.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); auditState.entityId = it.entityId; auditState.page = 1; loadAudit(); });
        idTd.append(a);
      } else idTd.textContent = '—';
      tr.append(idTd, el('td', 'small muted', it.ipAddress || ''));
      const full = el('tr', 'doc-full'); full.hidden = true;
      const td = el('td'); td.colSpan = 6;
      td.append(el('pre', 'cx-code', JSON.stringify(it.details ?? {}, null, 2)));
      full.append(td);
      tr.addEventListener('click', () => { full.hidden = !full.hidden; });
      tbody.append(tr, full);
    });
  }

  // ---- Подключение: адрес, ключ, промт для ИИ, примеры, схема (/api/meta/*) ----
  const BASE_URL = location.origin + API;
  // Служебные таблицы не нужны клиентам — в промт и краткую схему не берём.
  const META_HIDE = new Set(['users', 'roles', 'permissions', 'featureflags', 'rate_limit_entries', 'desktop_pairing_keys',
    'browserdevicegrants', 'deviceinvites', 'auditlogs', 'idempotency_records', 'counters', 'dictionary_labels', 'migration_flags']);
  const cxState = { schema: null, lang: 'sheets' };

  function fieldLabel(f) {
    let s = f.path + (f.required ? '*' : '');
    if (f.ref) s += '→' + f.ref;
    if (f.enum) s += ' [' + f.enum.slice(0, 6).join('|') + (f.enum.length > 6 ? '|…' : '') + ']';
    return s;
  }
  const SYS_FIELDS = new Set(['_id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy', 'organizationId']);

  function buildPrompt(schema) {
    const lines = (schema ? schema.collections : [])
      .filter((c) => !META_HIDE.has(c.collection) && c.kind !== 'crm')
      .map((c) => {
        const fs = c.fields.filter((f) => !SYS_FIELDS.has(f.path)).sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0)).slice(0, 16).map(fieldLabel).join(', ');
        return `- ${c.collection}${c.description ? ' — ' + c.description : ''}\n  поля: ${fs || '—'}`;
      });
    return [
      'Ты подключаешься к единой базе данных пользователя (Data Core) через REST API. Прямого доступа к БД нет — только API.',
      '',
      `Адрес API: ${BASE_URL}`,
      'Ключ: <ВСТАВЬ СЮДА КЛЮЧ kppd_…>',
      'Каждый запрос — с заголовком: Authorization: Bearer <ключ>',
      '',
      'Сначала прочитай (тем же ключом):',
      `1) GET ${BASE_URL}/meta/guide — правила, лимиты, ошибки (markdown)`,
      `2) GET ${BASE_URL}/meta/schema — все таблицы и поля (типы, обязательные, варианты значений)`,
      `3) GET ${BASE_URL}/meta/openapi.json — полный контракт маршрутов`,
      '',
      'Правила:',
      `- Данные нового приложения храни в ${BASE_URL}/apps/<приложение>/<коллекция> (GET список/один, POST объект или массив, PATCH, PUT, DELETE). Имя приложения — латиница и цифры без «_».`,
      '- Общие справочники (материалы, изделия, контрагенты, организации…) — через их маршруты; они общие с CRM, не ломай их. Лишние поля в теле запроса → 400.',
      '- Списки приходят как { items, total, page, limit }; у каждого объекта есть строковый id.',
      '- Не больше ~10 запросов в секунду; пачки — одним POST с массивом. Ключ не публикуй.',
      '',
      'Таблицы сейчас (* — обязательное, → ссылка):',
      ...lines,
    ].join('\n');
  }

  function codeSample(lang, app, coll) {
    const path = `/apps/${app}/${coll}`;
    if (lang === 'sheets') {
      return `// Google Таблица → Расширения → Apps Script. Ключ: Настройки проекта → Свойства скрипта → DATACORE_KEY
const BASE = '${BASE_URL}';
const KEY = PropertiesService.getScriptProperties().getProperty('DATACORE_KEY');
const PATH = '${path}';

function api(method, path, body) {
  const r = UrlFetchApp.fetch(BASE + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + KEY },
    payload: body ? JSON.stringify(body) : undefined,
  });
  if (r.getResponseCode() >= 300) throw new Error(r.getResponseCode() + ': ' + r.getContentText());
  return r.getContentText() ? JSON.parse(r.getContentText()) : null;
}

// Загрузить данные из базы на лист «${coll}» (первая строка — заголовки)
function pull() {
  const res = api('get', PATH + '?limit=200&sort=-createdAt');
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('${coll}') || ss.insertSheet('${coll}');
  const keys = ['id', ...new Set(res.items.flatMap(o => Object.keys(o)).filter(k => !['id', '_id'].includes(k)))];
  sh.clear();
  sh.getRange(1, 1, 1, keys.length).setValues([keys]);
  if (res.items.length) sh.getRange(2, 1, res.items.length, keys.length).setValues(
    res.items.map(o => keys.map(k => o[k] == null ? '' : typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k])));
}

// Отправить строки листа в базу: пустой id — создать, есть id — обновить
function push() {
  const sh = SpreadsheetApp.getActive().getSheetByName('${coll}');
  const [head, ...rows] = sh.getDataRange().getValues();
  const skip = ['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedAt'];
  rows.forEach(r => {
    const o = {}; head.forEach((h, i) => { if (h && !skip.includes(h) && r[i] !== '') o[h] = r[i]; });
    const id = r[head.indexOf('id')];
    if (id) api('patch', PATH + '/' + id, o); else api('post', PATH, o);
  });
  pull();
}`;
    }
    if (lang === 'python') {
      return `import requests

BASE = "${BASE_URL}"
H = {"Authorization": "Bearer kppd_..."}   # ключ лучше брать из переменной окружения

# создать (можно списком — до 500 шт.)
r = requests.post(f"{BASE}${path}", json={"customer": "Иван", "total": 1500}, headers=H, timeout=10)
r.raise_for_status(); item = r.json(); print(item["id"])

# список с фильтром и сортировкой
import json
q = {"filter": json.dumps({"total": {"$gte": 1000}}), "sort": "-createdAt", "limit": 50}
print(requests.get(f"{BASE}${path}", params=q, headers=H, timeout=10).json()["items"])

# изменить и удалить
requests.patch(f"{BASE}${path}/{item['id']}", json={"status": "paid"}, headers=H, timeout=10)
requests.delete(f"{BASE}${path}/{item['id']}", headers=H, timeout=10)`;
    }
    if (lang === 'js') {
      return `const BASE = '${BASE_URL}';
const KEY = process.env.DATACORE_KEY;   // kppd_...
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(r.status + ': ' + await r.text());
  return r.status === 204 ? null : r.json();
};

const item = await api('POST', '${path}', { customer: 'Иван', total: 1500 });
const list = await api('GET', '${path}?limit=50&sort=-createdAt&filter=' + encodeURIComponent(JSON.stringify({ total: { $gte: 1000 } })));
await api('PATCH', '${path}/' + item.id, { status: 'paid' });
await api('DELETE', '${path}/' + item.id);`;
    }
    return `KEY=kppd_...
curl -s -X POST "${BASE_URL}${path}" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"customer":"Иван","total":1500}'
curl -s "${BASE_URL}${path}?limit=50&sort=-createdAt" -H "Authorization: Bearer $KEY"
curl -s "${BASE_URL}/meta/schema" -H "Authorization: Bearer $KEY"`;
  }

  const LANG_NOTE = {
    sheets: 'Вставьте в Apps Script, сохраните ключ в «Свойствах скрипта» под именем DATACORE_KEY, запустите pull() — данные появятся на листе. Правьте строки и запускайте push().',
    python: 'Нужна библиотека requests (pip install requests).',
    js: 'Node.js 18+ или браузер (в браузере не храните ключ в открытом коде страницы).',
    curl: 'Для быстрой проверки из терминала.',
  };

  function renderCode() {
    const app = ($('#cx-app').value.trim().toLowerCase() || 'shop').replace(/[^a-z0-9]/g, '');
    const coll = ($('#cx-coll').value.trim().toLowerCase() || 'items').replace(/[^a-z0-9_]/g, '');
    $('#cx-code').textContent = codeSample(cxState.lang, app, coll);
    $('#cx-lang-note').textContent = LANG_NOTE[cxState.lang];
  }

  function renderSchema(schema) {
    const box = $('#cx-schema');
    box.replaceChildren();
    schema.collections.filter((c) => !META_HIDE.has(c.collection)).forEach((c) => {
      const d = el('details', 'cx-coll');
      const sum = el('summary');
      sum.append(el('b', 'mono', c.collection), el('span', 'muted small', ' ' + (c.description || '') + ' · полей: ' + c.fields.length));
      d.append(sum);
      const ul = el('ul', 'cx-fields');
      const add = (fields, prefix) => fields.forEach((f) => {
        const li = el('li', 'mono small', prefix + fieldLabel(f) + ' : ' + (f.itemType ? f.type + '<' + f.itemType + '>' : f.type));
        ul.append(li);
        if (f.fields) add(f.fields, prefix + f.path + '.');
      });
      add(c.fields, '');
      d.append(ul);
      box.append(d);
    });
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function fetchText(path) {
    const res = await fetch(API + path, { headers: { Authorization: `Bearer ${store.token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function loadConnect() {
    $('#cx-base').textContent = BASE_URL;
    renderCode();
    try {
      if (!cxState.schema) cxState.schema = await api('/meta/schema');
      $('#cx-prompt').value = buildPrompt(cxState.schema);
      renderSchema(cxState.schema);
    } catch (e) { $('#cx-prompt').value = buildPrompt(null); toast(e.message); }
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
  // Журнал
  $('#audit-form').addEventListener('submit', (e) => { e.preventDefault(); auditState.page = 1; auditState.entityId = ''; loadAudit(); });
  $('#audit-reset').addEventListener('click', () => { ['#audit-entity', '#audit-action', '#audit-user', '#audit-from', '#audit-to'].forEach((s) => { $(s).value = ''; }); auditState.entityId = ''; auditState.page = 1; loadAudit(); });
  $('#audit-prev').addEventListener('click', () => { auditState.page = Math.max(1, auditState.page - 1); loadAudit(); });
  $('#audit-next').addEventListener('click', () => { auditState.page += 1; loadAudit(); });
  // Подключение
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const src = $(b.dataset.copy); const text = src.value != null && src.tagName === 'TEXTAREA' ? src.value : src.textContent;
    try { await navigator.clipboard.writeText(text); toast('Скопировано'); } catch { toast('Не удалось скопировать — выделите и скопируйте вручную'); }
  }));
  document.querySelectorAll('.cx-lang').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.cx-lang').forEach((x) => x.classList.toggle('active', x === b));
    cxState.lang = b.dataset.lang; renderCode();
  }));
  $('#cx-app').addEventListener('input', renderCode);
  $('#cx-coll').addEventListener('input', renderCode);
  $('#cx-issue-key').addEventListener('click', openKeyDialog);
  $('#cx-dl-schema').addEventListener('click', async () => { try { download('datacore-schema.json', await fetchText('/meta/schema'), 'application/json'); } catch (e) { toast(e.message); } });
  $('#cx-dl-openapi').addEventListener('click', async () => { try { download('datacore-openapi.json', await fetchText('/meta/openapi.json'), 'application/json'); } catch (e) { toast(e.message); } });
  $('#cx-dl-guide').addEventListener('click', async () => { try { download('datacore-guide.md', await fetchText('/meta/guide'), 'text/markdown'); } catch (e) { toast(e.message); } });

  // ---- Boot ----
  if (store.token) showApp(); else showLogin();
})();
