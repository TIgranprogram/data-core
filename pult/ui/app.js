// Окно пульта: разделы, карточки, подтверждение, журнал запусков. Текст всегда идёт через textContent.
const token = document.querySelector('meta[name="pult-token"]').content;
const $ = (id) => document.getElementById(id);
const CONFIRM_RISKS = new Set(['prod-write', 'danger']);
const STATE_TEXT = { running: 'Идёт', ok: 'Готово', found: 'Есть находки', fail: 'Ошибка', stopped: 'Остановлено' };

const S = { status: null, catalog: null, section: 'now', query: '', jobs: new Map(), order: [], current: null, values: {}, advice: null, runs: {} };

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
  const todo = (S.advice?.items || []).filter((x) => x.level !== 'soon');
  for (const g of S.catalog.groups) {
    if (g.title) box.append(el('div', 'nav-group', g.title));
    for (const s of S.catalog.sections.filter((x) => x.group === g.id)) {
      const count = S.catalog.commands.filter((c) => c.section === s.id && !c.hidden).length + S.catalog.switches.filter((w) => w.section === s.id).length;
      const b = el('button', `nav-item${s.id === S.section && !S.query ? ' on' : ''}`);
      b.title = s.hint;
      const n = s.id === 'now' ? el('span', `n${todo.length ? ' alert' : ''}`, todo.length ? String(todo.length) : '') : el('span', 'n', String(count));
      b.append(el('span', 'ico', s.icon), el('span', '', s.title), n);
      b.onclick = () => { S.section = s.id; S.query = ''; $('search').value = ''; render(); };
      box.append(b);
    }
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
  const shown = S.catalog.commands.filter((c) => !c.hidden);
  if (!q) return shown.filter((c) => c.section === S.section);
  return shown.filter((c) => `${c.title} ${c.hint}`.toLowerCase().includes(q));
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
  const last = S.runs[c.id];
  if (last) meta.append(el('span', last.code === 0 ? '' : 'neg', `Запуск: ${whenText(last.at)}${last.code === 0 ? '' : ', ошибка'}`));
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

function switchCard(w) {
  const on = S.status ? !!S.status[w.state] : null;
  const live = [...S.jobs.values()].find((j) => [w.start, w.stop].includes(j.cmdId) && j.state === 'running');
  const c = S.catalog.commands.find((x) => x.id === (on ? w.stop : w.start));
  const box = el('article', `card switch${on ? ' on' : ''}`);
  const head = el('div', 'sw-head');
  const text = live ? 'Выполняется…' : on === null ? 'Проверяю…' : on ? 'Запущен' : 'Остановлен';
  head.append(el('h3', '', w.title), el('span', `sw-state${on && !live ? ' on' : ''}`, text));
  box.append(head, el('p', '', w.hint));
  const blocked = c.blocked[0] || (S.status && !S.status.docker ? 'Docker выключен: сначала запустите Docker Desktop' : '');
  if (blocked) box.append(el('div', 'why', blocked));
  const b = el('button', `${on ? 'ghost' : 'primary'} run`, live ? 'Идёт…' : on ? 'Остановить' : 'Запустить');
  b.disabled = !!live || !!blocked || on === null;
  b.onclick = () => press(c);
  box.append(b);
  return box;
}

function whenText(at) {
  const d = new Date(at);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `сегодня ${time}`;
  if (days === 1) return `вчера ${time}`;
  return `${days} дн. назад`;
}

async function todoAction(id, action) {
  try {
    await api('/api/todo', { id, action });
    if (action === 'done') loadStatus();
  } catch (e) { toast(e.message); }
}

function todoRow(item, level, first) {
  const c = S.catalog.commands.find((x) => x.id === item.cmd);
  const row = el('article', `todo ${level.id}${first ? ' first' : ''}`);
  const main = el('div', 'todo-main');
  if (first) main.append(el('em', 'todo-first', 'Начните с этого'));
  main.append(el('b', '', item.title || c.title), el('span', '', item.why));
  if (!c) {
    const acts = el('div', 'todo-acts');
    if (item.link) {
      const open = el('button', 'primary', 'Открыть');
      open.onclick = () => todoAction(item.todo, 'open');
      acts.append(open);
    }
    const done = el('button', 'ghost', 'Сделано');
    done.onclick = () => todoAction(item.todo, 'done');
    acts.append(done);
    row.append(main, acts);
    return row;
  }
  if (c.blocked.length) main.append(el('span', 'why', c.blocked[0]));
  const live = [...S.jobs.values()].some((j) => j.cmdId === c.id && j.state === 'running');
  const b = el('button', buttonClass(c), live ? 'Идёт…' : 'Запустить');
  b.disabled = live || c.blocked.length > 0;
  // пункт дел со своими значениями (например, какой скрипт) — подставить их; окно подтверждения их покажет
  b.onclick = () => { if (item.params) S.values[c.id] = { ...(S.values[c.id] || {}), ...item.params }; press(c); };
  row.append(main, b);
  return row;
}

function renderNow() {
  const box = el('div', 'now');
  const a = S.advice;
  if (!a) box.append(el('div', 'none', 'Смотрю состояние проекта…'));
  else {
    // одно главное дело: самое важное, что ждёт человека; плановое «Рекомендуется» главным не бывает
    const main = S.catalog.levels.filter((l) => l.id !== 'soon').flatMap((l) => a.items.filter((x) => x.level === l.id))[0];
    if (!main) box.append(el('div', 'now-clear', 'Сейчас от вас ничего не нужно.'));
    for (const level of S.catalog.levels) {
      const items = a.items.filter((x) => x.level === level.id);
      if (!items.length) continue;
      const sec = el('section', 'now-level');
      sec.append(el('h2', '', level.title), el('p', 'now-hint', level.hint), ...items.map((x) => todoRow(x, level, x === main)));
      box.append(sec);
    }
    if (a.done.length) {
      const sec = el('section', 'now-level');
      sec.append(el('h2', '', 'Сделано сегодня'));
      const names = a.done.map((d) => `${S.catalog.commands.find((c) => c.id === d.cmd)?.title} · ${whenText(d.at).replace('сегодня ', '')}`);
      sec.append(el('p', 'now-hint', names.join('   ·   ')));
      box.append(sec);
    }
  }
  $('cards').replaceChildren();
  $('now').replaceChildren(box);
}

function render() {
  renderNav();
  if (S.section === 'now' && !S.query) {
    const s = S.catalog.sections.find((x) => x.id === 'now');
    $('title').textContent = `${s.icon} ${s.title}`;
    $('subtitle').textContent = s.hint;
    renderNow();
    return;
  }
  $('now').replaceChildren();
  const sec = S.catalog.sections.find((s) => s.id === S.section);
  $('title').textContent = S.query ? 'Поиск' : `${sec.icon} ${sec.title}`;
  $('subtitle').textContent = S.query ? `По запросу «${S.query}»` : sec.hint;
  const list = visible();
  const box = $('cards');
  const nodes = S.query ? [] : S.catalog.switches.filter((w) => w.section === S.section).map(switchCard);
  let sub = null;
  for (const c of list) {
    if (!S.query && c.sub && c.sub !== sub) nodes.push(el('h2', 'sub-head', c.sub));
    sub = c.sub;
    nodes.push(card(c));
  }
  box.replaceChildren(...(nodes.length ? nodes : [el('div', 'none', 'Ничего не найдено. Попробуйте другое слово.')]));
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
    if (!S.query && ['now', 'stand'].includes(S.section)) render();
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
  S.status = s;
  S.advice = s.advice;
  S.runs = s.runs;
  if (S.query || !['now', 'stand'].includes(S.section)) renderNav(); else render();
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
