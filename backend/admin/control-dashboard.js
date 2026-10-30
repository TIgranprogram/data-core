/* Вкладка «Состояние» (CC-22): показатели сайта по дням и месяцам. Классический скрипт, без библиотек.
   Подключается до admin.js; admin.js зовёт window.dcControl.open(корень, { api, el, toast }). */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 864e5;
  const PERIODS = [
    { id: '30', label: '30 дней', days: 30 },
    { id: '90', label: '90 дней', days: 90 },
    { id: 'year', label: 'Год', months: 12 },
    { id: 'months', label: 'Свои месяцы' },
  ];
  const NODATA = 'нет данных';
  const state = { period: '30', mFrom: '', mTo: '' };
  let catalog = null;

  const iso = (d) => d.toISOString().slice(0, 10);
  const monthKey = (d) => d.toISOString().slice(0, 7);
  const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return monthKey(d); };
  const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1) + 1; };
  const num = (v, max) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: max == null ? 1 : max });
  const dayRu = (s) => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const shortRu = (s) => (s.length === 7 ? s.slice(5) + '.' + s.slice(2, 4) : s.slice(8) + '.' + s.slice(5, 7));

  /** Значение с единицей по-русски. null — «нет данных», а не 0. */
  function fmt(v, unit) {
    if (v == null || Number.isNaN(v)) return NODATA;
    switch (unit) {
      case 'байт': {
        const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0, x = Math.abs(v);
        while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
        return (v < 0 ? '−' : '') + num(x, x >= 100 ? 0 : 1) + ' ' + u[i];
      }
      case '1/0': return v ? 'да' : 'нет';
      case 'с': return v >= 120 ? num(v / 60, 0) + ' мин' : num(v, 0) + ' с';
      case 'номер': return String(v);
      default: return num(v) + (unit ? (unit === '%' ? ' %' : ' ' + unit) : '');
    }
  }

  /** Изменение к прошлому периоду: «выросло на …» без оценки «хорошо/плохо» (она зависит от показателя). */
  function change(cur, prev, unit) {
    if (cur == null || prev == null) return { text: 'нет данных для сравнения', cls: 'muted' };
    if (unit === '1/0') return { text: cur === prev ? 'как раньше' : 'было: ' + fmt(prev, unit), cls: 'muted' };
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return { text: 'без изменений', cls: 'muted' };
    return { text: (d > 0 ? '▲ +' : '▼ −') + fmt(Math.abs(d), unit), cls: 'cc-delta' };
  }

  const lastOf = (series) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].v != null) return series[i].v; return null; };

  /** Мини-график: линия на своём SVG, пропуски (null) разрывают линию. */
  function spark(series, label) {
    const W = 120, H = 32, P = 3;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'cc-spark'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label + ': график за период');
    const vals = series.filter((p) => p.v != null).map((p) => p.v);
    if (!vals.length) { svg.setAttribute('class', 'cc-spark cc-spark-empty'); return svg; }
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = (i) => (series.length < 2 ? W / 2 : P + (i * (W - 2 * P)) / (series.length - 1));
    const y = (v) => (hi === lo ? H / 2 : H - P - ((v - lo) / span) * (H - 2 * P));
    let seg = [];
    const flush = () => {
      if (seg.length > 1) { const pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('points', seg.join(' ')); pl.setAttribute('class', 'cc-line'); svg.append(pl); }
      seg = [];
    };
    series.forEach((p, i) => { if (p.v == null) flush(); else seg.push(x(i).toFixed(1) + ',' + y(p.v).toFixed(1)); });
    flush();
    const li = series.length - 1 - [...series].reverse().findIndex((p) => p.v != null);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x(li).toFixed(1)); dot.setAttribute('cy', y(series[li].v).toFixed(1)); dot.setAttribute('r', 2.5); dot.setAttribute('class', 'cc-dot');
    svg.append(dot);
    return svg;
  }

  function open(root, kit) {
    const { api, el, toast } = kit;
    const items = (r) => (r && Array.isArray(r.items) ? r.items : []);

    const today = new Date();
    if (!state.mTo) { state.mTo = monthKey(today); state.mFrom = addMonths(state.mTo, -5); }

    const bar = el('div', 'cc-pbar'), body = el('div', 'cc-body');
    root.replaceChildren(bar, body);

    function drawBar() {
      const seg = el('div', 'cc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Период');
      PERIODS.forEach((p) => {
        const b = el('button', 'btn btn-sm' + (state.period === p.id ? ' btn-primary' : ''), p.label); b.type = 'button';
        b.setAttribute('aria-pressed', String(state.period === p.id));
        b.addEventListener('click', () => { state.period = p.id; drawBar(); load(); });
        seg.append(b);
      });
      bar.replaceChildren(seg);
      if (state.period === 'months') {
        const a = el('input', 'cc-month'), b = el('input', 'cc-month'); a.type = b.type = 'month'; a.value = state.mFrom; b.value = state.mTo;
        const go = el('button', 'btn btn-sm', 'Показать'); go.type = 'button';
        go.addEventListener('click', () => {
          if (!a.value || !b.value || a.value > b.value) { toast('Укажите месяцы: «с» не позже «по»'); return; }
          if (monthsBetween(a.value, b.value) > 60) { toast('Не больше 60 месяцев за раз'); return; }
          state.mFrom = a.value; state.mTo = b.value; load();
        });
        const f = el('div', 'cc-range'); f.append(el('span', 'muted', 'с'), a, el('span', 'muted', 'по'), b, go);
        bar.append(f);
      }
    }

    /** Строит { cur: [{k,m}], prev: [...] } — точки текущего и прошлого периода одной длины. */
    async function fetchPeriod() {
      const p = PERIODS.find((x) => x.id === state.period);
      if (p.days) {
        const from = iso(new Date(today.getTime() - (2 * p.days - 1) * DAY)), cut = iso(new Date(today.getTime() - (p.days - 1) * DAY));
        const rows = items(await api(`/control/daily?from=${from}&to=${iso(today)}&limit=500`));
        const pick = (r) => ({ k: r.date, m: r.m || {} });
        return { monthly: false, cur: rows.filter((r) => r.date >= cut).map(pick), prev: rows.filter((r) => r.date < cut).map(pick) };
      }
      const to = p.months ? monthKey(today) : state.mTo;
      const n = p.months || monthsBetween(state.mFrom, state.mTo);
      const from = addMonths(to, -(n - 1)), pfrom = addMonths(from, -n);
      const rows = items(await api(`/control/monthly?from=${pfrom}&to=${to}&limit=120`));
      const pick = (r) => ({ k: r.month, m: Object.fromEntries(Object.entries(r.m || {}).map(([key, s]) => [key, s && s.last != null ? s.last : null])) });
      return { monthly: true, cur: rows.filter((r) => r.month >= from).map(pick), prev: rows.filter((r) => r.month < from).map(pick) };
    }

    function card(title, value, sub) {
      const c = el('div', 'cx-card cc-stat');
      c.append(el('div', 'muted small', title), el('div', 'cc-big' + (value === NODATA ? ' cc-nodata' : ''), value));
      if (sub) c.append(el('div', 'muted small', sub));
      return c;
    }

    function drawHead(latest, defs) {
      const box = el('div');
      const row = el('div', 'cc-headline');
      if (latest) {
        row.append(el('b', '', 'Последний снимок: ' + dayRu(latest.date)));
        const age = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(latest.date + 'T00:00:00Z').getTime()) / DAY);
        if (age > 1) { const s = el('span', 'badge bad', 'снимок устарел: ' + age + ' дн. назад'); row.append(s); }
      } else row.append(el('b', '', 'Снимков пока нет'));
      const m = latest ? latest.m || {} : {};
      const v = (k) => (m[k] == null ? null : m[k]);
      const U = (k) => (defs.get(k) ? defs.get(k).unit : '');
      const red = v('code.steps_red'), green = v('code.steps_green');
      const cards = el('div', 'cc-cards');
      cards.append(
        card('Сайт был доступен', fmt(v('avail.uptime_pct'), '%'), v('avail.uptime_pct') == null ? 'ещё не собирается' : ''),
        card('Ответ сервера, медленные 5%', fmt(v('speed.p95_ms'), U('speed.p95_ms'))),
        card('Ошибок у пользователей', fmt(v('errors.total'), U('errors.total'))),
        card('Записей, которые нужно заполнить', fmt(v('data.fill_total'), U('data.fill_total'))),
        card('Возраст последней копии', fmt(v('backups.local_age_h'), 'ч')),
        card('Диск занят', fmt(v('storage.disk_used_pct'), '%')),
        card('Ночной прогон', red == null || green == null ? NODATA : red === 0 ? 'всё прошло' : 'упало шагов: ' + red, red == null || green == null ? '' : 'прошло шагов: ' + green),
      );
      box.append(row, cards);
      return box;
    }

    function drawGroups(data, defs, groups) {
      const frag = el('div');
      const idle = [];
      const byGroup = new Map();
      for (const d of defs.values()) {
        if (d.source === 'none') { idle.push(d); continue; }
        if (!byGroup.has(d.group)) byGroup.set(d.group, []);
        byGroup.get(d.group).push(d);
      }
      for (const [g, list] of byGroup) {
        const c = el('section', 'cx-card cc-group'); c.append(el('h3', '', groups[g] || g));
        const empty = [];
        for (const d of list) {
          const sc = data.cur.map((r) => ({ k: r.k, v: r.m[d.key] == null ? null : Number(r.m[d.key]) }));
          const sp = data.prev.map((r) => ({ k: r.k, v: r.m[d.key] == null ? null : Number(r.m[d.key]) }));
          const cur = lastOf(sc), ch = change(cur, lastOf(sp), d.unit);
          if (cur == null) { empty.push(d.label); continue; }
          const row = el('div', 'cc-row');
          const g1 = spark(sc, d.label);
          row.append(el('div', 'cc-label', d.label), g1, el('div', 'cc-val' + (cur == null ? ' cc-nodata' : ''), fmt(cur, d.unit)), el('div', 'cc-chg small ' + ch.cls, ch.text));
          c.append(row);
        }
        if (empty.length) c.append(el('p', 'muted small cc-none', 'Пока нет данных: ' + empty.join(', ')));
        frag.append(c);
      }
      if (idle.length) {
        const det = el('details', 'cx-card cc-idle');
        det.append(el('summary', '', 'Ещё не собираются (' + idle.length + ')'));
        det.append(el('p', 'muted small', 'Для этих показателей пока нет источника данных. Они появятся на экране сами, когда источник подключат.'));
        const ul = el('ul', 'cc-idle-list');
        idle.forEach((d) => { const li = el('li'); li.append(el('b', '', d.label), el('span', 'muted small', ' — ' + (groups[d.group] || '') + (d.needs ? '. Нужно: ' + d.needs : ''))); ul.append(li); });
        det.append(ul); frag.append(det);
      }
      return frag;
    }

    /** «Прогоны»: списка прогонов на сервере нет — берём то, что лежит в дневных показателях code.*. */
    function drawRuns(rows) {
      const c = el('section', 'cx-card cc-group'); c.append(el('h3', '', 'Прогоны'));
      const runs = rows.filter((r) => ['code.steps_green', 'code.steps_red', 'code.run_duration_s'].some((k) => r.m[k] != null)).slice(-14).reverse();
      if (!runs.length) { c.append(el('p', 'muted', 'Ночных прогонов пока не было. Результат появится после первой ночи.')); return c; }
      c.append(el('p', 'muted small', 'Итог последнего прогона за каждый день. Подробности шагов здесь пока не видны.'));
      const tb = el('table', 'table cc-runs'), hd = el('tr');
      ['День', 'Итог', 'Шагов прошло', 'Шагов упало', 'Длительность', 'Проверка сценариев', 'Проверка экранов'].forEach((t) => hd.append(el('th', '', t)));
      tb.append(el('thead')); tb.firstChild.append(hd);
      const tbody = el('tbody');
      runs.forEach((r) => {
        const red = r.m['code.steps_red'], tr = el('tr');
        const verdict = el('td'); verdict.append(el('span', 'badge ' + (red == null ? '' : red === 0 ? 'ok' : 'bad'), red == null ? NODATA : red === 0 ? 'прошёл' : 'упал'));
        tr.append(el('td', '', dayRu(r.k)), verdict, el('td', '', fmt(r.m['code.steps_green'], 'шт')), el('td', '', fmt(red, 'шт')), el('td', '', fmt(r.m['code.run_duration_s'], 'с')), el('td', '', fmt(r.m['code.e2e_ok'], '1/0')), el('td', '', fmt(r.m['code.smoke_ok'], '1/0')));
        tbody.append(tr);
      });
      tb.append(tbody);
      const wrap = el('div', 'table-wrap'); wrap.append(tb); c.append(wrap);
      return c;
    }

    async function load() {
      body.replaceChildren(el('p', 'muted', 'Загрузка…'));
      try {
        const [cat, latestRes, data] = await Promise.all([
          catalog ? Promise.resolve(catalog) : api('/control/catalog'),
          api(`/control/daily?from=${iso(new Date(today.getTime() - 10 * DAY))}&to=${iso(today)}&limit=20`),
          fetchPeriod(),
        ]);
        catalog = cat;
        const defs = new Map(items(cat).map((d) => [d.key, d]));
        const dayRows = items(latestRes);
        const latest = dayRows.length ? dayRows[dayRows.length - 1] : null;
        if (!latest && !data.cur.length) {
          const e = el('div', 'cx-card cc-empty'); e.append(el('h3', '', 'Пока нечего показывать'), el('p', '', 'Первый снимок появится после 23:30.'), el('p', 'muted small', 'Каждую ночь сервер записывает показатели сайта. Через несколько дней здесь будут графики.'));
          body.replaceChildren(e); return;
        }
        const title = el('p', 'panel-note', data.monthly ? 'Графики по месяцам: берётся последнее значение месяца. Изменение — к такому же прошлому периоду.' : 'Графики по дням. Изменение — к такому же прошлому периоду (последнее значение к последнему).');
        const nodes = [drawHead(latest, defs), title, drawGroups(data, defs, cat.groups || {})];
        // «Прогоны»: по дням, если период дневной; иначе — последние дни из короткой выборки
        nodes.push(drawRuns(data.monthly ? dayRows.map((r) => ({ k: r.date, m: r.m || {} })) : data.cur));
        body.replaceChildren(...nodes);
        if (!data.cur.length) body.prepend(el('p', 'muted', 'За выбранный период снимков нет — показаны только последние данные в шапке.'));
      } catch (e) {
        const msg = /403|Forbidden/i.test(e.message) ? 'Этот раздел доступен только администратору.' : 'Не удалось загрузить показатели. Проверьте связь и попробуйте ещё раз.';
        const box = el('div', 'cx-card'); const retry = el('button', 'btn btn-primary', 'Повторить'); retry.type = 'button';
        retry.addEventListener('click', load);
        box.append(el('p', 'error', msg), retry); body.replaceChildren(box);
      }
    }

    drawBar();
    return load();
  }

  window.dcControl = { open, fmt, change };
})();
