// Окно пульта: разделы, карточки, подтверждение, журнал запусков. Текст всегда идёт через textContent.
import { isBatchSafe } from './chain.mjs';
const token = document.querySelector('meta[name="pult-token"]').content;
const $ = (id) => document.getElementById(id);
const CONFIRM_RISKS = new Set(['prod-write', 'danger']);
const STATE_TEXT = { running: 'Идёт', ok: 'Готово', found: 'Есть находки', fail: 'Ошибка', stopped: 'Остановлено' };

const S = { status: null, catalog: null, section: 'now', query: '', jobs: new Map(), order: [], current: null, values: {}, advice: null, runs: {}, schedule: null };

/** Цвет группы раздела: полоса в меню и на карточках. */
const colorOf = (sectionId) => {
  const sec = S.catalog.sections.find((x) => x.id === sectionId);
  return S.catalog.groups.find((g) => g.id === sec?.group)?.color || 'start';
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Pult-Token': token, 'Content-Type': 'application/json', ...(chainOn ? { 'X-Pult-Chain': '1' } : {}) },
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
    if (g.title) { const h = el('div', 'nav-group', g.title); h.dataset.color = g.color; box.append(h); }
    for (const s of S.catalog.sections.filter((x) => x.group === g.id)) {
      const count = s.id === 'auto' && S.schedule ? S.schedule.items.filter((r) => r.enabled).length
        : S.catalog.commands.filter((c) => c.section === s.id && !c.hidden).length + S.catalog.switches.filter((w) => w.section === s.id).length;
      const b = el('button', `nav-item${s.id === S.section && !S.query ? ' on' : ''}`);
      b.dataset.color = g.color;
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
  if (!q) {
    // подзаголовки — в порядке раздела (subs): сверху главное, ниже редкое; внутри — порядок каталога
    const subs = S.catalog.sections.find((s) => s.id === S.section)?.subs || [];
    const at = (c) => { const i = subs.indexOf(c.sub); return i < 0 ? subs.length : i; };
    return shown.filter((c) => c.section === S.section).map((c, i) => [c, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([c]) => c);
  }
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
  box.dataset.color = colorOf(c.section);
  const auto = S.schedule?.items.find((r) => r.id === c.id && r.enabled);
  box.append(el('h3', '', c.title), el('p', '', c.hint));
  const meta = el('div', 'meta');
  meta.append(el('span', `badge ${c.risk}`, S.catalog.risks[c.risk].label), el('span', '', `≈ ${c.time}`));
  const last = S.runs[c.id];
  if (last) meta.append(el('span', last.code === 0 ? '' : 'neg', `Запуск: ${whenText(last.at)}${last.code === 0 ? '' : ', ошибка'}`));
  if (auto) meta.append(el('span', 'auto-tag', `⏰ ${auto.text.toLowerCase()}`));
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
  box.dataset.color = colorOf(w.section);
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

/** Плашка проверки — только если ещё не гоняли или есть проблема. «Всё ок» на экран не выводим. */
function renderCheck(a) {
  const check = a.check;
  const problem = check && (check.code !== 0 || check.bad?.length);
  if (check && !problem) return null;
  const tone = !check ? 'warn' : check.code !== 0 ? 'bad' : 'warn';
  const row = el('div', `now-check ${tone}`);
  const text = el('div', 'now-check-text');
  const cmdId = check?.cmd || 'code-check';
  const cmd = S.catalog.commands.find((c) => c.id === cmdId);
  const title = cmd?.title || 'Тесты кода: быстро';
  if (!check) {
    text.append(el('b', '', 'Проверок с этого пульта ещё не было.'), el('span', '', 'Нажмите «Тесты кода: быстро». Они скажут, всё ли в порядке.'));
  } else if (check.code !== 0) {
    text.append(el('b', '', `${title} не прошла ${whenText(check.at)}.`), el('span', '', check.last || 'Подробности в журнале справа.'));
  } else {
    text.append(el('b', '', `${title} ${whenText(check.at)} нашла замечание.`), el('span', '', check.bad[0]));
  }
  row.append(text);
  const already = (a.items || []).some((x) => x.cmd === cmdId);
  if (cmd && !already) {
    const b = el('button', 'primary', !check ? 'Запустить' : 'Проверить снова');
    const live = [...S.jobs.values()].some((j) => j.cmdId === cmd.id && j.state === 'running');
    b.disabled = live || (cmd.blocked || []).length > 0;
    b.onclick = () => press(cmd);
    row.append(b);
  }
  return row;
}

function renderNow() {
  const box = el('div', 'now');
  const a = S.advice;
  if (!a) box.append(el('div', 'none', 'Смотрю состояние проекта…'));
  else {
    const checkRow = renderCheck(a);
    // одно главное дело: самое важное, что ждёт человека; плановое «Рекомендуется» главным не бывает
    const main = S.catalog.levels.filter((l) => l.id !== 'soon').flatMap((l) => a.items.filter((x) => x.level === l.id))[0];
    const hasItems = (a.items || []).length > 0;
    // Пусто и проверка зелёная — экран без текста и пустых блоков (правило пользователя 2026-11-03).
    if (!hasItems && !checkRow) {
      $('cards').replaceChildren();
      $('now').replaceChildren(box);
      return;
    }
    if (checkRow) box.append(checkRow);
    for (const level of S.catalog.levels) {
      const items = a.items.filter((x) => x.level === level.id);
      if (!items.length) continue;
      const sec = el('section', 'now-level');
      sec.append(el('h2', '', level.title));
      // цепочка: два и больше пунктов, которые можно запустить подряд без слова
      const chainN = chainItems().reduce((n, x) => n + 1 + (x.next || 0), 0); // видимые + скрытые следующие шаги цепочек
      if (level.id === 'you' && chainN > 1) {
        const all = el('button', 'primary warn', chainOn ? 'Выполняю по очереди…' : `Выполнить все по очереди (${chainN})`);
        all.disabled = chainOn; all.onclick = runChain;
        sec.append(all);
      }
      sec.append(...items.map((x) => todoRow(x, level, x === main)));
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
  if (S.section === 'auto' && !S.query) renderAuto();
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

// ---------- автозапуск ----------

function whenNext(at) {
  const d = new Date(at);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `сегодня ${time}`;
  if (days === 1) return `завтра ${time}`;
  return `${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

async function saveRule(id, patch) {
  try { S.schedule = await api('/api/schedule', { id, ...patch }); toast('Расписание сохранено'); } catch (e) { toast(e.message); }
  render();
}

function autoRow(r) {
  const row = el('div', `auto-row${r.enabled ? '' : ' off'}`);
  row.dataset.color = colorOf(r.section);
  const sw = el('input');
  sw.type = 'checkbox';
  sw.checked = r.enabled;
  sw.title = r.enabled ? 'Выключить' : 'Включить';
  sw.setAttribute('aria-label', `Автозапуск: ${r.title}`);
  sw.onchange = () => saveRule(r.id, { enabled: sw.checked });
  const main = el('div', 'auto-main');
  main.append(el('b', '', r.title), el('span', '', r.hint));
  if (r.blocked.length) main.append(el('span', 'why', r.blocked[0]));
  const ctl = el('div', 'auto-ctl');
  const kind = el('select');
  for (const [v, t] of Object.entries(S.schedule.kinds)) { const o = el('option', '', t); o.value = v; kind.append(o); }
  kind.value = r.kind;
  kind.onchange = () => saveRule(r.id, { kind: kind.value, day: kind.value === 'daily' ? undefined : r.day || 1 });
  ctl.append(kind);
  if (r.kind !== 'daily') {
    const day = el('select');
    const opts = r.kind === 'weekly' ? S.schedule.weekdays.map((w, i) => [i + 1, w]) : Array.from({ length: 28 }, (_, i) => [i + 1, `${i + 1}-го`]);
    for (const [v, t] of opts) { const o = el('option', '', t); o.value = String(v); day.append(o); }
    day.value = String(r.day || 1);
    day.onchange = () => saveRule(r.id, { day: Number(day.value) });
    ctl.append(day);
  }
  const time = el('input');
  time.type = 'time';
  time.value = r.time;
  time.onchange = () => { if (time.value) saveRule(r.id, { time: time.value }); };
  ctl.append(time);
  const when = el('div', 'auto-when');
  when.append(el('span', '', r.next ? `Следующий: ${whenNext(r.next)}` : 'Выключено'));
  if (r.last) when.append(el('span', r.last.code === 0 ? '' : 'neg', `Прошлый: ${whenText(r.last.at)}${r.last.code === 0 ? '' : ', ошибка'}`));
  row.append(sw, main, ctl, when);
  return row;
}

function renderAuto() {
  const box = el('div', 'auto');
  box.append(el('p', 'now-hint', 'Пока пульт открыт, он сам запускает эти команды. ПК спал или пульт был закрыт — пропущенное пойдёт при следующем открытии. Команды идут по одной и не мешают ручным. Запись на рабочий сайт сама не запускается никогда.'));
  if (!S.schedule) box.append(el('div', 'none', 'Загружаю расписание…'));
  else box.append(...S.schedule.items.map(autoRow));
  $('now').replaceChildren(box);
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
    if (r.job) { addJob({ ...r.job, lines: [] }); select(r.job.id); return r.job.id; }
  } catch (e) { toast(e.message); }
  return null;
}

// ---------- цепочка «Выполнить всё по очереди» (2026-10-31) ----------
// Пункты «Нужно от вас» с командой и без слова-подтверждения: одно подтверждение, дальше сами, по одному; ошибка — стоп.
let chainOn = false;
const chainCmd = (x) => { const c = x.cmd && S.catalog.commands.find((k) => k.id === x.cmd); return isBatchSafe(c) ? c : null; };
const chainItems = () => (S.advice?.items || []).filter((x) => x.level === 'you' && chainCmd(x));
const waitJob = (id) => new Promise((ok) => { const t = setInterval(() => { const j = S.jobs.get(id); if (j && j.state !== 'running') { clearInterval(t); ok(j); } }, 1000); });
async function runChain() {
  const list = chainItems();
  if (!list.length || chainOn) return;
  const more = list.reduce((n, x) => n + (x.next || 0), 0);
  const msg = [`Выполнить по очереди (${list.length + more}):`, '', ...list.map((x, i) => `${i + 1}. ${x.title}${x.next ? ` (и следующие шаги: ${x.next})` : ''}`), '', 'Пакетно запускаются только безопасные проверки. Изменение сайта или данных потребует отдельного подтверждения. Ошибка — остановка.'].join('\n');
  if (!confirm(msg)) return;
  chainOn = true; render();
  const seen = new Set();
  try {
    for (;;) {
      await loadStatus();
      const x = chainItems()[0];
      if (!x || seen.has(x.todo)) break; // кончились; или пункт не закрылся — не крутить его снова
      seen.add(x.todo);
      const c = chainCmd(x);
      if (x.params) S.values[c.id] = { ...(S.values[c.id] || {}), ...x.params };
      const id = await launch(c, { confirmed: true });
      if (!id) break;
      const j = await waitJob(id);
      if (j.state === 'fail') { toast(`Остановлено: ошибка в «${x.title}»`); break; }
    }
  } finally { chainOn = false; await loadStatus(); }
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
    if (!S.query && ['now', 'stand', 'auto'].includes(S.section)) render();
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
  try { s = await api('/api/status'); } catch (e) {
    // пульт перезапустился с новым кодом: старый ключ сессии не подходит или сервер ещё поднимается — перезагрузить окно
    if (/401|ключа сессии|Failed to fetch|NetworkError/i.test(String(e.message))) setTimeout(() => location.reload(), 1500);
    return;
  }
  if (s.restarting) { toast('Пульт обновился — перезагружаю окно…'); setTimeout(() => location.reload(), 2500); }
  S.status = s;
  S.advice = s.advice;
  S.runs = s.runs;
  S.schedule = await api('/api/schedule').catch(() => S.schedule);
  if (S.query || !['now', 'stand', 'auto'].includes(S.section)) renderNav(); else render();
  const list = [
    s.site == null ? pill('warn', 'Прод не проверялся', 'Отдельная кнопка «Проверить прод» выполняет live-запрос') : s.site ? pill('ok', `Сайт работает${s.version ? ` · ${s.version}` : ''}`) : pill('bad', 'Сайт не отвечает', 'Запустите «Сервер сайта → Осмотр сайта»'),
    s.gateFiles.length
      ? pill('warn', `Выкладка закрыта: файлов без коммита ${s.gateFiles.length}`, s.gateFiles.join('\n'))
      : pill('ok', 'Незакоммиченного кода нет', 'Ворота проверяют backend, deploy, docker-compose.prod.yml'),
    pill(s.ahead || s.behind ? 'warn' : 'ok', `${s.branch}: GitHub ${s.ahead ? `впереди ${s.ahead}` : ''}${s.behind ? ` позади ${s.behind}` : ''}${!s.ahead && !s.behind ? 'совпадает' : ''}`),
    s.docker ? pill('ok', 'Docker запущен') : pill('', 'Docker выключен', 'Нужен только для стендов и e2e'),
    s.route ? pill('ok', `Сервер: ${s.route}`) : pill('warn', 'Нет ключа сервера'),
    s.admin ? pill('ok', 'Администратор') : pill('', 'Обычные права', 'Для кнопок пульта права администратора не обязательны'),
  ];
  $('pills').replaceChildren(...list);
  const pv = $('pultVer');
  if (pv) {
    const p = s.pult;
    if (!p) {
      pv.className = 'pill';
      pv.textContent = 'Пульт · ?';
      pv.title = 'Сервер не прислал версию пульта';
    } else if (s.restarting || (p.disk && p.stamp && p.disk !== p.stamp)) {
      pv.className = 'pill warn';
      pv.textContent = 'Пульт · обновляется';
      pv.title = p.reason || `Отпечаток ${p.stamp} → ${p.disk}`;
    } else if (!p.current) {
      pv.className = 'pill warn';
      pv.textContent = 'Пульт · не последняя';
      pv.title = p.reason || 'Каталог или файлы пульта отстали от проекта';
    } else {
      pv.className = 'pill ok';
      pv.textContent = `Пульт · актуален · ${p.stamp}`;
      pv.title = `Отпечаток кода пульта (файлы pult/): ${p.stamp}. Совпадает с диском, каталог кнопок совпадает с проектом.`;
    }
  }
}

async function start() {
  S.catalog = await api('/api/catalog');
  S.schedule = await api('/api/schedule').catch(() => null);
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStatus(); });
  connectEvents();
  setInterval(() => { if (S.jobs.get(S.current)?.state === 'running') renderHead(); }, 1000);
}

function connectEvents() {
  const events = new EventSource(`/api/events?t=${token}`);
  let down = false;
  events.onmessage = (m) => onEvent(JSON.parse(m.data));
  events.onerror = () => {
    if (down) return;
    down = true;
    events.close();
    setTimeout(() => { loadStatus().finally(connectEvents); }, 2000);
  };
}

$('search').oninput = (e) => { S.query = e.target.value; render(); };
$('refresh').onclick = loadStatus;
start().catch((e) => toast(e.message));
