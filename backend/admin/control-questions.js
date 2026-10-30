/* Вкладка «Разбор» (CC-18): вопросы, на которые отвечает человек. Классический скрипт, без библиотек.
   Подключается до admin.js; admin.js зовёт window.dcQuestions.open(корень, { api, el, toast }).
   Все тексты с сервера — только через textContent (el(tag, cls, text)). */
(function () {
  'use strict';
  const LIMIT = 50;
  const SNOOZE_MAX = 2;
  const SPECIAL = ['dismiss', 'snooze', 'reply', 'to_agent'];
  const STATUS = { open: 'Нужно решить', executing: 'Выполняется', done: 'Решено', failed: 'Сбой', waiting_agent: 'У помощника', snoozed: 'Отложено', dismissed: 'Не проблема', resolved_auto: 'Решилось само', expired: 'Устарел' };
  const SEV = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
  const RISK = { safe: 'Безопасно', reversible: 'Можно отменить', irreversible: 'Нельзя отменить' };
  const EVENT = { created: 'Вопрос создан', seen: 'Встретился снова', woke: 'Вернулся после отсрочки', returned: 'Вернулся от помощника', reopened: 'Открыт заново', escalated: 'Важность повышена', snoozed: 'Отложен', to_agent: 'Передан помощнику', executing: 'Действие запущено', done: 'Решён', failed: 'Сбой', undone: 'Действие отменено', dismissed: 'Не проблема', reply: 'Текстовый ответ' };
  // Сводка: id → какие статусы грузим. «Просроченные» — подмножество «нужно решить» и «сбой».
  const CHIPS = [
    { id: 'need', label: 'Нужно решить', st: 'open', count: (c) => c.open || 0 },
    { id: 'overdue', label: 'Просроченные', st: 'open,failed', warn: true },
    { id: 'snoozed', label: 'Отложено', st: 'snoozed', count: (c) => c.snoozed || 0 },
    { id: 'failed', label: 'Сбой', st: 'failed', warn: true, count: (c) => c.failed || 0 },
    { id: 'agent', label: 'У помощника', st: 'waiting_agent', count: (c) => c.waiting_agent || 0 },
    { id: 'closed', label: 'Закрыто', st: 'done,dismissed,resolved_auto,expired', count: (c) => (c.done || 0) + (c.dismissed || 0) + (c.resolved_auto || 0) + (c.expired || 0) },
  ];
  const state = { chip: 'need', type: '', severity: '', page: 1 };

  const when = (v, withTime) => {
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleString('ru-RU', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const ymd = (d) => d.toISOString().slice(0, 10);

  function open(root, kit) {
    const { api, el, toast } = kit;
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    let types = [], counts = {}, items = [], total = 0, overdueN = null, cur = null, token = 0;

    const sum = el('div', 'cc-sum'), bar = el('div', 'cc-qbar'), list = el('div', 'cc-qlist');
    root.replaceChildren(sum, bar, list);
    const back = el('div', 'cc-dback'), drawer = el('aside', 'cc-drawer');
    drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Вопрос'); drawer.hidden = back.hidden = true;
    root.append(back, drawer);
    back.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && root.isConnected) closeDrawer(); });
    let lastBtn = null;

    const typeTitle = (t) => (types.find((x) => x.type === t) || {}).title || 'Другое';
    const chip = () => CHIPS.find((c) => c.id === state.chip);
    const errText = (e) => (/403|Forbidden/i.test(e.message) ? 'Этот раздел доступен только администратору.' : e.message || 'Не получилось. Попробуйте ещё раз.');

    function drawSum() {
      sum.replaceChildren();
      CHIPS.forEach((c) => {
        const n = c.id === 'overdue' ? overdueN : c.count(counts);
        const b = el('button', 'cc-chip' + (state.chip === c.id ? ' on' : '') + (c.warn && n ? ' warn' : ''));
        b.type = 'button'; b.setAttribute('aria-pressed', String(state.chip === c.id));
        b.append(el('span', 'cc-chip-n', n == null ? '–' : String(n)), el('span', 'cc-chip-t', c.label));
        b.addEventListener('click', () => { state.chip = c.id; state.page = 1; load(); });
        sum.append(b);
      });
    }

    function drawBar() {
      const t = el('select'), s = el('select');
      t.setAttribute('aria-label', 'Тип вопроса'); s.setAttribute('aria-label', 'Важность');
      t.append(new Option('Все типы', '')); types.forEach((x) => t.append(new Option(x.title, x.type)));
      s.append(new Option('Любая важность', ''), new Option('Высокая', 'high'), new Option('Средняя', 'medium'), new Option('Низкая', 'low'));
      t.value = state.type; s.value = state.severity;
      t.addEventListener('change', () => { state.type = t.value; state.page = 1; load(); });
      s.addEventListener('change', () => { state.severity = s.value; state.page = 1; load(); });
      const re = el('button', 'btn', 'Обновить'); re.type = 'button'; re.addEventListener('click', load);
      bar.replaceChildren(t, s, re);
    }

    function query(st, page, limit) {
      const q = new URLSearchParams({ status: st, page, limit });
      if (state.type) q.set('type', state.type);
      if (state.severity) q.set('severity', state.severity);
      return `/control/questions?${q}`;
    }

    async function load() {
      const my = ++token;
      list.replaceChildren(el('p', 'muted', 'Загрузка…'));
      try {
        const c = chip();
        const r = await api(query(c.st, state.page, c.id === 'overdue' ? 200 : LIMIT));
        const human = c.id === 'overdue' ? r : await api(query('open,failed', 1, 200));
        if (my !== token) return;
        counts = r.counts || {}; types = r.types || types;
        overdueN = (human.items || []).filter((q) => q.overdue).length;
        items = c.id === 'overdue' ? (r.items || []).filter((q) => q.overdue) : r.items || [];
        total = c.id === 'overdue' ? items.length : r.total || 0;
        drawSum(); drawBar(); drawList();
      } catch (e) {
        if (my !== token) return;
        const box = el('div', 'cx-card'), retry = el('button', 'btn btn-primary', 'Повторить'); retry.type = 'button';
        retry.addEventListener('click', load);
        box.append(el('p', 'error', errText(e)), retry); list.replaceChildren(box);
      }
    }

    function sevBadge(sev) { return el('span', 'cc-sev ' + sev, SEV[sev] || sev); }

    function drawList() {
      if (!items.length) {
        const e = el('div', 'cx-card cc-empty');
        e.append(el('h3', '', state.chip === 'need' ? 'Вопросов нет: всё решено' : 'В этом списке пусто'), el('p', 'muted', state.chip === 'need' ? 'Новые вопросы появятся здесь сами, когда помощник что-то найдёт.' : 'Выберите другой пункт сверху или сбросьте фильтры.'));
        list.replaceChildren(e); return;
      }
      const tb = el('table', 'table cc-qtable'), hd = el('tr');
      ['Важность', 'Вопрос', 'Тип', 'Встречался', 'Срок'].forEach((t, i) => hd.append(el('th', 'cc-c' + i, t)));
      const th = el('thead'); th.append(hd); tb.append(th);
      const body = el('tbody');
      items.forEach((q) => {
        const tr = el('tr', 'cc-qrow' + (q.overdue ? ' overdue' : '') + (cur && cur.id === q.id ? ' sel' : ''));
        const a = el('td', 'cc-c0'); a.append(sevBadge(q.severity));
        const w = el('td', 'cc-c1'); const wb = el('button', 'cc-what', q.what); wb.type = 'button'; w.append(wb);
        if (q.status !== 'open') w.append(el('span', 'cc-st st-' + q.status, STATUS[q.status] || ''));
        const due = el('td', 'cc-c4');
        due.append(el('span', '', when(q.dueAt)));
        if (q.overdue) due.append(el('span', 'cc-late', 'просрочено'));
        tr.append(a, w, el('td', 'cc-c2 muted', typeTitle(q.type)), el('td', 'cc-c3 num', q.seen && q.seen.count > 1 ? '×' + q.seen.count : '1 раз'), due);
        tr.addEventListener('click', () => { lastBtn = wb; show(q.id, tr); });
        body.append(tr);
      });
      tb.append(body);
      const wrap = el('div', 'table-wrap'); wrap.append(tb);
      list.replaceChildren(wrap);
      if (items.length < total && chip().id !== 'overdue') {
        const more = el('button', 'btn cc-more', `Показать ещё (${total - items.length})`); more.type = 'button';
        more.addEventListener('click', async () => {
          more.classList.add('is-busy'); state.page++;
          try { const r = await api(query(chip().st, state.page, LIMIT)); items = items.concat(r.items || []); drawList(); } catch (e) { state.page--; more.classList.remove('is-busy'); toast(errText(e)); }
        });
        list.append(more);
      }
    }

    // ---------- Правая панель ----------
    function closeDrawer() {
      drawer.hidden = back.hidden = true; cur = null; root.parentElement.classList.remove('cc-docked');
      list.querySelectorAll('.cc-qrow.sel').forEach((r) => r.classList.remove('sel'));
      if (lastBtn && lastBtn.isConnected) lastBtn.focus();
      lastBtn = null;
    }

    async function show(id, row) {
      list.querySelectorAll('.cc-qrow.sel').forEach((r) => r.classList.remove('sel'));
      if (row) row.classList.add('sel');
      drawer.hidden = false; back.hidden = false; root.parentElement.classList.add('cc-docked');
      drawer.replaceChildren(el('p', 'cc-pad muted', 'Загрузка…'));
      try { paint(await api(`/control/questions/${id}`)); }
      catch (e) { const b = el('button', 'btn', 'Закрыть'); b.type = 'button'; b.addEventListener('click', closeDrawer); const p = el('div', 'cc-pad'); p.append(el('p', 'error', errText(e)), b); drawer.replaceChildren(p); }
    }

    const field = (title, text) => { const f = el('div', 'cc-f'); f.append(el('div', 'cc-ft', title), el('div', 'cc-fv', text)); return f; };

    function paint(q, ui) {
      cur = q; ui = ui || {}; drawer.classList.remove('is-busy');
      const head = el('div', 'cc-dhead'), t = el('div', 'cc-dt');
      t.append(el('h2', '', typeTitle(q.type)), el('div', 'muted small', STATUS[q.status] || ''));
      const x = el('button', 'btn btn-sm', 'Закрыть'); x.type = 'button'; x.addEventListener('click', closeDrawer);
      head.append(t, sevBadge(q.severity), x);

      const body = el('div', 'cc-dbody');
      body.append(field('Что случилось', q.what), field('Что требуется', q.need));
      if (q.advice) body.append(field('Совет помощника', q.advice));
      const meta = [`Встречался: ${q.seen && q.seen.count > 1 ? q.seen.count + ' раз' : '1 раз'}`, 'Срок: ' + when(q.dueAt) + (q.overdue ? ' (просрочено)' : '')];
      if (q.snoozeCount) meta.push(`Отложен: ${q.snoozeCount} из ${SNOOZE_MAX}`);
      body.append(el('p', 'muted small cc-meta' + (q.overdue ? ' late' : ''), meta.join(' · ')));

      const acts = el('div', 'cc-acts'), area = el('div', 'cc-area');
      const busy = (on) => { drawer.classList.toggle('is-busy', on); drawer.querySelectorAll('button').forEach((b) => { if (b !== x) b.disabled = on; }); };
      if (q.status === 'executing') area.append(el('p', 'cc-note', 'Идёт выполнение… Обычно это несколько секунд.'));
      if (q.status === 'failed' || (q.exec && q.exec.state === 'failed' && q.status === 'open')) {
        const f = el('div', 'cc-fail'); f.append(el('b', '', 'Не получилось выполнить.'), el('p', '', (q.exec && q.exec.error) || 'Причина не указана.'), el('p', 'muted small', `Попыток: ${(q.exec && q.exec.attempts) || 1}. Данные не изменены, можно повторить.`));
        area.append(f);
      }
      if (q.status === 'waiting_agent') area.append(el('p', 'cc-note', 'Вопрос у помощника. Он вернёт его сам, если понадобится ваше решение.'));
      if (q.status === 'snoozed') area.append(el('p', 'cc-note', 'Вопрос отложен и вернётся сам.'));
      if (['done', 'dismissed', 'resolved_auto', 'expired'].includes(q.status)) area.append(el('p', 'cc-note ok', 'Вопрос закрыт: ' + (STATUS[q.status] || '').toLowerCase() + '.'));

      const answerable = ['open', 'failed', 'snoozed', 'waiting_agent'].includes(q.status);
      if (answerable && !ui.mode) (q.options || []).forEach((o) => {
        const b = el('button', 'btn' + (o.risk === 'irreversible' ? ' btn-danger' : ''), o.label); b.type = 'button';
        if (o.code === 'snooze' && q.snoozeCount >= SNOOZE_MAX) { b.disabled = true; b.title = 'Откладывать можно не больше 2 раз'; }
        b.addEventListener('click', () => choose(q, o, busy));
        acts.append(b);
        if (o.risk === 'irreversible') acts.append(el('span', 'cc-risk bad small', RISK.irreversible));
      });
      if (q.status === 'failed' && !ui.mode) {
        const o = (q.options || []).find((z) => z.actionId || (!SPECIAL.includes(z.code) && !z.link));
        if (o) { const r = el('button', 'btn btn-primary', 'Повторить'); r.type = 'button'; r.addEventListener('click', () => choose(q, o, busy)); acts.prepend(r); }
      }
      if (q.canUndo) {
        const u = el('button', 'btn', 'Отменить'); u.type = 'button';
        u.addEventListener('click', async () => {
          busy(true);
          try { const r = await post(`/control/questions/${q.id}/undo`); toast('Действие отменено'); load(); paint(r && r.id ? r : await api(`/control/questions/${q.id}`)); }
          catch (e) { busy(false); toast(errText(e)); }
        });
        acts.append(u);
      }
      if (ui.mode) area.append(ui.mode);
      body.append(area, acts);

      const evs = el('div', 'cc-events'); evs.append(el('h3', '', 'Журнал'), el('p', 'muted small', 'Загрузка…'));
      body.append(evs);
      drawer.replaceChildren(head, body);
      x.focus();
      api(`/control/questions/${q.id}/events?limit=100`).then((r) => {
        const ul = el('ul', 'cc-evlist');
        (r.items || []).forEach((e) => { const li = el('li'); li.append(el('span', 'muted small', when(e.at, true)), el('span', '', ' ' + (EVENT[e.kind] || 'Событие') + (e.by && e.by !== 'system' ? ' — ' + e.by : '')));
          if (e.note) li.append(el('div', 'muted small cc-evnote', e.note)); ul.append(li); });
        evs.replaceChildren(el('h3', '', 'Журнал'), (r.items || []).length ? ul : el('p', 'muted small', 'Записей пока нет.'));
      }).catch(() => { evs.replaceChildren(el('h3', '', 'Журнал'), el('p', 'muted small', 'Не удалось загрузить журнал.')); });
    }

    /** Ответ с сервера: вопрос обновляем в панели, список перечитываем. */
    async function send(q, payload, busy, okText) {
      busy(true);
      try {
        const r = await post(`/control/questions/${q.id}/answer`, payload);
        toast(okText || 'Готово'); load();
        paint(r && r.id ? r : await api(`/control/questions/${q.id}`));
      } catch (e) {
        busy(false);
        if (e.body && e.body.preview) { toast('Данные изменились'); planView(q, optOf(q, payload.optionCode), e.body.preview, busy, 'Данные изменились с момента предпросмотра. Проверьте новый план и подтвердите ещё раз.'); }
        else { toast(errText(e)); if (/уже|закрыт/i.test(e.message || '')) load(); }
      }
    }
    const optOf = (q, code) => (q.options || []).find((o) => o.code === code) || { code, label: code, risk: 'reversible' };

    function choose(q, o, busy) {
      if (o.link) { window.open('../app/#' + o.link.section + (o.link.id ? '?open=' + encodeURIComponent(o.link.id) : ''), '_blank', 'noopener'); return; }
      if (o.code === 'dismiss') return send(q, { optionCode: o.code }, busy, 'Отмечено: не проблема');
      if (o.code === 'to_agent') return send(q, { optionCode: o.code }, busy, 'Передано помощнику');
      if (o.code === 'snooze') return snoozeForm(q, o, busy);
      if (o.code === 'reply') return replyForm(q, o, busy);
      return startPlan(q, o, busy);
    }

    function formBox(q, o, busy, title, inputs, submitText, make) {
      const f = el('form', 'cc-form'); f.append(el('b', '', title), ...inputs);
      const go = el('button', 'btn btn-primary', submitText); go.type = 'submit';
      const no = el('button', 'btn', 'Назад'); no.type = 'button'; no.addEventListener('click', () => paint(q));
      const row = el('div', 'cc-acts'); row.append(go, no); f.append(row);
      f.addEventListener('submit', (e) => { e.preventDefault(); const p = make(); if (p) send(q, p, busy, null); });
      paint(q, { mode: f }); f.querySelector('input,textarea').focus();
    }

    function snoozeForm(q, o, busy) {
      const d = new Date(Date.now() + 7 * 864e5), min = new Date(Date.now() + 864e5), left = SNOOZE_MAX - q.snoozeCount;
      const inp = el('input'); inp.type = 'date'; inp.value = ymd(d); inp.min = ymd(min); inp.setAttribute('aria-label', 'Вернуть вопрос в этот день');
      formBox(q, o, busy, 'Вернуть вопрос в этот день', [inp, el('p', 'muted small', `Отложить можно не больше ${SNOOZE_MAX} раз. Осталось: ${left}.`), el('p', 'error cc-err')], 'Отложить', () => {
        if (!inp.value || inp.value < ymd(min)) { document.querySelector('.cc-err').textContent = 'Выберите дату не раньше завтрашней.'; return null; }
        return { optionCode: o.code, snoozeUntil: inp.value };
      });
    }

    function replyForm(q, o, busy) {
      const ta = el('textarea'); ta.rows = 4; ta.maxLength = 600; ta.placeholder = 'Ваш ответ помощнику'; ta.setAttribute('aria-label', 'Текст ответа');
      formBox(q, o, busy, 'Текстовый ответ', [ta, el('p', 'error cc-err')], 'Отправить', () => {
        if (!ta.value.trim()) { document.querySelector('.cc-err').textContent = 'Напишите ответ: поле не может быть пустым.'; return null; }
        return { optionCode: o.code, comment: ta.value.trim() };
      });
    }

    async function startPlan(q, o, busy) {
      busy(true);
      try { planView(q, o, await post(`/control/questions/${q.id}/preview`, { optionCode: o.code }), busy); }
      catch (e) { busy(false); toast(errText(e)); }
    }

    function planView(q, o, pv, busy, warn) {
      const box = el('div', 'cc-plan'), bad = pv.risk === 'irreversible';
      if (warn) box.append(el('p', 'cc-note warn', warn));
      box.append(el('b', '', `Что будет: «${o.label}»`));
      const ul = el('ul', 'cc-lines'); (pv.lines || []).forEach((l) => ul.append(el('li', '', l)));
      box.append(ul, el('p', 'small cc-risk' + (bad ? ' bad' : ''), RISK[pv.risk] || ''));
      const ok = el('button', 'btn ' + (bad ? 'btn-danger' : 'btn-primary'), bad ? 'Подтвердить без отмены' : 'Подтвердить'); ok.type = 'button';
      const no = el('button', 'btn', 'Назад'); no.type = 'button'; no.addEventListener('click', () => paint(q));
      const row = el('div', 'cc-acts');
      if (bad) {
        const lb = el('label', 'cc-agree'), cb = el('input'); cb.type = 'checkbox'; ok.disabled = true;
        cb.addEventListener('change', () => { ok.disabled = !cb.checked; });
        lb.append(cb, document.createTextNode(' Понимаю: после этого вернуть всё назад нельзя')); box.append(lb);
      }
      ok.addEventListener('click', () => send(q, { optionCode: o.code, planHash: pv.planHash }, busy, 'Готово: действие выполнено'));
      row.append(ok, no); box.append(row);
      paint(q, { mode: box });
    }

    drawSum(); drawBar();
    return load();
  }

  window.dcQuestions = { open };
})();
