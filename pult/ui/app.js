// Окно пульта: разделы, карточки, подтверждение, журнал запусков. Текст всегда идёт через textContent.
const token = document.querySelector('meta[name="pult-token"]').content;
const $ = (id) => document.getElementById(id);
const CONFIRM_RISKS = new Set(['prod-write', 'danger']);
const STATE_TEXT = { running: 'Идёт', ok: 'Готово', fail: 'Ошибка', stopped: 'Остановлено' };

const S = { catalog: null, section: 'day', query: '', jobs: new Map(), order: [], current: null, values: {} };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Pult-Token': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
  return data;
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---------- разделы и карточки ----------

function renderNav() {
  const box = $('nav');
  box.replaceChildren();
  for (const s of S.catalog.sections) {
    const count = S.catalog.commands.filter((c) => c.section === s.id).length;
    const b = el('button', `nav-item${s.id === S.section && !S.query ? ' on' : ''}`);
    b.title = s.hint;
    b.append(el('span', 'ico', s.icon), el('span', '', s.title), el('span', 'n', String(count)));
    b.onclick = () => { S.section = s.id; S.query = ''; $('search').value = ''; render(); };
    box.append(b);
  }
}

function renderLegend() {
  const box = $('legend');
  box.replaceChildren();
  for (const [k, r] of Object.entries(S.catalog.risks)) {
    const d = el('div');
    d.append(el('span', `badge ${k}`, r.label), el('span', '', r.hint));
    box.append(d);
  }
}

function visible() {
  const q = S.query.trim().toLowerCase();
  if (!q) return S.catalog.commands.filter((c) => c.section === S.section);
  return S.catalog.commands.filter((c) => `${c.title} ${c.hint}`.toLowerCase().includes(q));
}

function paramValue(c, p) {
  return S.values[c.id]?.[p.name] ?? p.default ?? p.options[0]?.value ?? '';
}

function buttonClass(c) {
  if (c.risk === 'danger') return 'primary danger';
  if (c.risk === 'prod-write') return 'primary warn';
  return 'primary';
}

function card(c) {
  const box = el('article', `card${c.blocked.length ? ' off' : ''}`);
  box.dataset.id = c.id;
  box.append(el('h3', '', c.title), el('p', '', c.hint));
  const meta = el('div', 'meta');
  meta.append(el('span', `badge ${c.risk}`, S.catalog.risks[c.risk].label), el('span', '', `≈ ${c.time}`));
  box.append(meta);
  for (const p of c.params) {
    const label = el('label', 'param', p.label);
    const sel = el('select');
    for (const o of p.options) {
      const opt = el('option', '', o.label);
      opt.value = o.value;
      sel.append(opt);
    }
    sel.value = paramValue(c, p);
    sel.onchange = () => { (S.values[c.id] ??= {})[p.name] = sel.value; };
    label.append(sel);
    box.append(label);
  }
  if (c.blocked.length) box.append(el('div', 'why', c.blocked[0]));
  const b = el('button', `${buttonClass(c)} run`, c.kind === 'job' ? 'Запустить' : 'Открыть');
  b.disabled = c.blocked.length > 0;
  b.onclick = () => press(c);
  box.append(b);
  return box;
}

function render() {
  renderNav();
  const sec = S.catalog.sections.find((s) => s.id === S.section);
  $('title').textContent = S.query ? 'Поиск' : `${sec.icon} ${sec.title}`;
  $('subtitle').textContent = S.query ? `По запросу «${S.query}»` : sec.hint;
  const list = visible();
  const box = $('cards');
  box.replaceChildren(...(list.length ? list.map(card) : [el('div', 'none', 'Ничего не найдено. Попробуйте другое слово.')]));
}

// ---------- запуск ----------

function paramsOf(c) {
  return Object.fromEntries(c.params.map((p) => [p.name, paramValue(c, p)]));
}

async function press(c) {
  if (CONFIRM_RISKS.has(c.risk) || c.confirm) return askConfirm(c);
  return launch(c, {});
}

async function launch(c, extra) {
  try {
    const r = await api('/api/run', { id: c.id, params: paramsOf(c), ...extra });
    if (r.job) { addJob({ ...r.job, lines: [] }); select(r.job.id); }
  } catch (e) { toast(e.message); }
}

function askConfirm(c) {
  const d = $('confirm');
  $('cTitle').textContent = c.title;
  $('cRisk').textContent = S.catalog.risks[c.risk].label;
  $('cRisk').className = `badge ${c.risk}`;
  $('cText').textContent = c.confirm;
  const shown = c.params.map((p) => `${p.label}: ${p.options.find((o) => o.value === paramValue(c, p))?.label ?? '—'}`);
  $('cParams').hidden = !shown.length;
  $('cParams').textContent = shown.join(' · ');
  $('cWordBox').hidden = !c.word;
  $('cWordHint').textContent = c.word || '';
  const word = $('cWord');
  const ok = $('cOk');
  word.value = '';
  ok.className = buttonClass(c);
  ok.disabled = !!c.word;
  word.oninput = () => { ok.disabled = word.value !== c.word; };
  $('cCancel').onclick = () => d.close();
  $('confirmForm').onsubmit = (ev) => {
    ev.preventDefault();
    if (c.word && word.value !== c.word) return;
    d.close();
    launch(c, { confirmed: true, word: c.word ? word.value : undefined });
  };
  d.showModal();
  if (c.word) word.focus(); else $('cCancel').focus();
}

// ---------- журнал ----------

function addJob(job) {
  const known = S.jobs.get(job.id);
  if (known) { Object.assign(known, job, { lines: known.lines }); return known; }
  S.jobs.set(job.id, job);
  S.order.push(job.id);
  return job;
}

function renderTabs() {
  const box = $('tabs');
  box.replaceChildren(...S.order.map((id) => {
    const j = S.jobs.get(id);
    const t = el('div', `tab ${j.state}${id === S.current ? ' on' : ''}`);
    const name = el('button', 'tab-name', j.title);
    name.title = `${j.title}: ${STATE_TEXT[j.state]}`;
    name.onclick = () => select(id);
    t.append(name);
    if (j.state !== 'running') {
      const x = el('button', 'tab-x', '×');
      x.title = 'Закрыть вкладку';
      x.setAttribute('aria-label', `Закрыть вкладку: ${j.title}`);
      x.onclick = () => closeTabs([id]);
      t.append(x);
    }
    return t;
  }));
  $('tabbar').hidden = !S.order.length;
  $('closeAll').hidden = !S.order.some((id) => S.jobs.get(id).state !== 'running');
}

async function closeTabs(ids) {
  try {
    const r = await api('/api/close', { ids });
    if (!ids && r.running) toast(`Идущие команды остались открыты: ${r.running}`);
  } catch (e) { toast(e.message); }
}

function forget(ids) {
  for (const id of ids) S.jobs.delete(id);
  S.order = S.order.filter((id) => S.jobs.has(id));
  if (!S.jobs.has(S.current)) select(S.order[S.order.length - 1] ?? null);
  else renderTabs();
}

function duration(j) {
  const sec = Math.round(((j.endedAt || Date.now()) - j.startedAt) / 1000);
  return sec < 60 ? `${sec} с` : `${Math.floor(sec / 60)} мин ${sec % 60} с`;
}

function renderHead() {
  const j = S.jobs.get(S.current);
  $('empty').hidden = !!j;
  $('jobHead').hidden = !j;
  if (!j) { $('advice').hidden = true; return; }
  $('jobTitle').textContent = j.title;
  const st = $('jobState');
  st.className = `state ${j.state}`;
  const code = j.state === 'fail' ? `, код ${j.code}` : '';
  st.textContent = `${STATE_TEXT[j.state]}${code} · ${duration(j)}`;
  $('stopBtn').hidden = j.state !== 'running';
  const adv = $('advice');
  adv.hidden = !j.advice?.length;
  adv.replaceChildren(...(j.advice || []).map((a) => el('div', '', `Что делать: ${a}`)));
}

function select(id) {
  S.current = id;
  renderTabs();
  renderHead();
  const j = S.jobs.get(id);
  $('out').textContent = j?.lines.length ? `${j.lines.join('\n')}\n` : '';
  $('out').scrollTop = $('out').scrollHeight;
}

function onEvent(ev) {
  if (ev.type === 'start') {
    addJob({ ...ev.job, lines: [] });
    renderTabs();
  } else if (ev.type === 'line') {
    const j = S.jobs.get(ev.id);
    if (!j) return;
    j.lines.push(ev.line);
    if (ev.id === S.current) {
      const out = $('out');
      const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
      out.append(`${ev.line}\n`);
      if (stick) out.scrollTop = out.scrollHeight;
    }
  } else if (ev.type === 'closed') {
    forget(ev.ids);
  } else if (ev.type === 'end') {
    addJob(ev.job);
    renderTabs();
    if (ev.job.id === S.current) renderHead();
    loadStatus();
  }
}

$('closeAll').onclick = () => closeTabs();

$('stopBtn').onclick = async () => {
  const j = S.jobs.get(S.current);
  if (!j) return;
  const risky = CONFIRM_RISKS.has(j.risk);
  if (risky && !window.confirm('Остановка посреди записи на сайт может оставить его в неполном состоянии. Остановить?')) return;
  try { await api('/api/stop', { id: j.id }); } catch (e) { toast(e.message); }
};

$('copyBtn').onclick = async () => {
  const j = S.jobs.get(S.current);
  if (!j) return;
  await navigator.clipboard.writeText(j.lines.join('\n'));
  toast('Вывод скопирован');
};

// ---------- состояние ----------

function pill(kind, text, title) {
  const p = el('span', `pill ${kind}`, text);
  if (title) p.title = title;
  return p;
}

async function loadStatus() {
  let s;
  try { s = await api('/api/status'); } catch { return; }
  const list = [
    s.site ? pill('ok', `Сайт работает${s.version ? ` · ${s.version}` : ''}`) : pill('bad', 'Сайт не отвечает', 'Запустите «Рабочий сайт → Осмотр сайта»'),
    s.gateFiles.length
      ? pill('warn', `Выкладка закрыта: файлов без коммита ${s.gateFiles.length}`, s.gateFiles.join('\n'))
      : pill('ok', 'Незакоммиченного кода нет', 'Ворота проверяют backend, deploy, docker-compose.prod.yml'),
    pill(s.ahead || s.behind ? 'warn' : 'ok', `${s.branch}: GitHub ${s.ahead ? `впереди ${s.ahead}` : ''}${s.behind ? ` позади ${s.behind}` : ''}${!s.ahead && !s.behind ? 'совпадает' : ''}`),
    s.docker ? pill('ok', 'Docker запущен') : pill('', 'Docker выключен', 'Нужен только для стендов и e2e'),
    s.route ? pill('ok', `Сервер: ${s.route}`) : pill('warn', 'Нет ключа сервера'),
    s.admin ? pill('ok', 'Администратор') : pill('', 'Обычные права', 'Для кнопок пульта права администратора не обязательны'),
  ];
  $('pills').replaceChildren(...list);
}

async function start() {
  S.catalog = await api('/api/catalog');
  renderLegend();
  render();
  const { problems } = S.catalog;
  if (problems.length) {
    $('banner').hidden = false;
    $('banner').textContent = `Пульт отстал от проекта: ${problems.join('; ')}. Попросите Claude обновить pult/catalog.mjs.`;
  }
  const jobs = await api('/api/jobs');
  for (const j of jobs.items) addJob(j);
  if (S.order.length) select(S.order[S.order.length - 1]);
  loadStatus();
  setInterval(loadStatus, 60000);
  const events = new EventSource(`/api/events?t=${token}`);
  events.onmessage = (m) => onEvent(JSON.parse(m.data));
  setInterval(() => { if (S.jobs.get(S.current)?.state === 'running') renderHead(); }, 1000);
}

$('search').oninput = (e) => { S.query = e.target.value; render(); };
$('refresh').onclick = loadStatus;
start().catch((e) => toast(e.message));
