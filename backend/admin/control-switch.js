/* Вкладка «Серверы» (SW-4): какой сервер главный, кнопка «Переключить сейчас», аварийное включение. Классический скрипт, без библиотек.
   Подключается до admin.js; admin.js зовёт window.dcSwitch.open(корень, { api, el, toast }). Тексты — только через textContent. */
(function () {
  'use strict';
  const STEPS = [
    ['preflight', 'Проверка'], ['readonly', 'Пауза записи'], ['dump', 'Копия базы'], ['restore', 'Передача на второй сервер'], ['photos', 'Фото'],
    ['verify', 'Сверка'], ['promote', 'Запуск второго'], ['vps', 'Переключение домена'], ['finish', 'Готово'],
  ];
  const REFRESH_STEPS = [
    ['preflight', 'Проверка'], ['readonly', 'Пауза записи'], ['dump', 'Копия базы'], ['restore', 'Передача'],
    ['photos', 'Фото'], ['code', 'Код'], ['verify', 'Сверка'], ['finish', 'Готово'],
  ];
  const isRefresh = (j) => {
    const dir = String((j && j.direction) || '');
    return dir === 'refresh' || dir.startsWith('refresh');
  };
  const stepId = (j) => {
    const s = String((j && j.step) || '');
    if (isRefresh(j) && (s === 'photos_pre' || s.startsWith('photos'))) return 'photos';
    return s;
  };
  const NAME = { home: 'Домашний', office: 'Офисный' };
  const PHRASE = 'Я ПОНИМАЮ';
  const FAST = 3000, SLOW = 30000;
  let timer = 0;

  const ageText = (m) => {
    if (m == null) return 'нет данных';
    if (m < 1) return 'меньше минуты назад';
    if (m < 90) return Math.round(m) + ' мин назад';
    if (m < 2880) return Math.round(m / 60) + ' ч назад';
    return Math.round(m / 1440) + ' дн назад';
  };
  const running = (j) => !!j && (j.state === 'queued' || j.state === 'running');

  function open(root, kit) {
    const { api, el, toast } = kit;
    clearTimeout(timer);
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
    const shell = el('div', 'sw-box'), box = el('div', 'sw-box');
    shell.append(box);
    const back = el('div', 'sw-back'), drawer = el('aside', 'sw-drawer');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.hidden = back.hidden = true;
    const dlg = document.createElement('dialog');
    dlg.className = 'sw-confirm';
    root.replaceChildren(shell, back, drawer, dlg);
    const alive = () => shell.isConnected && !(root.closest('.tab-panel') || {}).hidden;
    let data = null, token = 0, lastBtn = null, screenMs = null, countTimer = 0;
    let canCloseDrawer = () => true;
    const stopCount = () => { clearInterval(countTimer); countTimer = 0; };
    dlg.addEventListener('close', stopCount);
    const closeConfirm = () => { stopCount(); if (dlg.open) dlg.close(); dlg.replaceChildren(); };

    const closeDrawer = () => {
      if (!canCloseDrawer()) return;
      drawer.hidden = back.hidden = true;
      shell.inert = false;
      drawer.replaceChildren();
      if (lastBtn?.isConnected) lastBtn.focus();
    };
    back.addEventListener('click', closeDrawer);
    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      const controls = [...drawer.querySelectorAll('button,input,select')]
        .filter((control) => !control.matches(':disabled') && !control.closest('[hidden]'));
      const edge = e.shiftKey ? controls[0] : controls.at(-1);
      if (edge && document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? controls.at(-1) : controls[0]).focus();
      }
    });

    function openDrawer(title, build, btn, canClose = () => true) {
      lastBtn = btn || null;
      canCloseDrawer = canClose;
      drawer.setAttribute('aria-label', title);
      const head = el('div', 'cc-dhead'), t = el('div', 'cc-dt'), x = el('button', 'btn btn-sm', 'Закрыть');
      t.append(el('h2', '', title)); x.type = 'button'; x.addEventListener('click', closeDrawer); head.append(t, x);
      const body = el('div', 'cc-dbody');
      build(body);
      drawer.replaceChildren(head, body);
      drawer.hidden = back.hidden = false;
      shell.inert = true;
      (body.querySelector('input,button') || x).focus();
    }

    const failText = (e, what) => {
      if (e.status === 409) return e.body?.message || 'Состояние серверов изменилось. Обновите экран.';
      if (e.status === 503) return e.body?.message || 'Нет связи со служебным мостом на сервере. ' + what + ' не начато.';
      if (e.status === 403) return 'Это действие доступно только администратору.';
      return e.message || 'Не получилось. Попробуйте ещё раз.';
    };

    function card(name, d) {
      const mine = hereName(d) === name, main = isMainCol(name, d);
      const p = d.peer || {};
      const c = el('section', 'sw-card' + (main ? ' main' : '') + (mine ? ' mine' : ''));
      const h = el('div', 'sw-ch');
      h.append(el('h3', '', NAME[name]), el('span', 'sw-tag ' + (main ? 'ok' : ''), main ? 'Главный' : 'Запасной'));
      if (mine) h.append(el('span', 'sw-tag you', 'Вы здесь'));
      const rows = el('dl', 'sw-kv');
      const row = (k, v, cls) => { rows.append(el('dt', '', k), el('dd', cls || '', v)); };
      if (mine) {
        const paused = d.mode === 'readonly';
        row('Работает', paused ? 'Запись на паузе' : 'Да, в обычном режиме', paused ? 'warn' : 'ok');
        row('Версия кода', d.version || 'нет данных');
      } else if (d.enabled === false && !p.configured) {
        row('Работает', 'Не проверяется: адрес не задан', 'warn');
      } else {
        row('Работает', p.healthy == null ? 'Неизвестно' : p.healthy ? 'Да' : 'Не отвечает', p.healthy == null ? 'warn' : p.healthy ? 'ok' : 'bad');
        row('Версия кода', p.version || 'нет данных');
      }
      if (!main && (!mine || d.enabled === false)) row('Возраст копии данных', ageText(p.copyAgeMin));
      if (!mine && p.checkedAt) row('Проверен (МСК)', new Date(p.checkedAt).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }));
      c.append(h, rows);
      return c;
    }

    function progress(j) {
      const refresh = isRefresh(j);
      const steps = !refresh ? STEPS : REFRESH_STEPS.filter(([id]) => id !== 'code' || j.refreshScope !== 'data');
      const ru = Object.fromEntries(steps);
      const cur = stepId(j);
      const idx = Math.max(0, steps.findIndex((s) => s[0] === cur));
      const w = el('div', 'sw-job');
      const task = refresh ? (j.refreshScope === 'data' ? 'Обновление данных' : 'Обновление кода и данных') : 'Переключение';
      const head = task + (j.state === 'done' ? ' завершено' : j.state === 'failed' ? ' не завершилось' : ' выполняется');
      w.append(el('h3', 'sw-jt' + (j.state === 'failed' ? ' bad' : j.state === 'done' ? ' ok' : ''), head));
      const ol = el('ol', 'sw-steps');
      steps.forEach(([id, label], i) => {
        let st = 'todo';
        if (j.state === 'done' || i < idx) st = 'done';
        else if (i === idx) st = j.state === 'failed' ? 'fail' : 'now';
        const li = el('li', 'sw-step ' + st);
        li.append(el('span', 'sw-mark', st === 'done' ? '✓' : st === 'fail' ? '!' : st === 'now' ? '…' : String(i + 1)), el('span', '', label));
        ol.append(li);
      });
      w.append(ol);
      if (j.warning) w.append(el('p', 'cc-note warn', j.warning));
      if (j.state === 'failed') {
        const f = el('div', 'cc-fail');
        f.append(el('strong', '', 'Остановилось на шаге «' + (ru[cur] || 'этот шаг') + '».'));
        f.append(el('p', '', j.error ? String(j.error) : 'Причина не указана.'));
        f.append(el('p', '', refresh
          ? 'Проверьте состояние серверов выше. Если запись осталась на паузе, повторите обновление.'
          : 'Проверьте состояние серверов выше. Если запись осталась на паузе, повторите переключение.'));
        w.append(f);
      }
      return w;
    }

    function confirmStart(btn) {
      lastBtn = btn || null;
      closeConfirm();
      const to = data.self === 'home' ? NAME.office : NAME.home;
      const form = el('form', 'dialog-form');
      form.addEventListener('submit', (e) => e.preventDefault());
      form.append(el('h3', '', 'Переключить сервер'));
      form.append(el('p', '', 'Главным станет сервер «' + to + '».'));
      form.append(el('p', 'cc-note warn', 'Запись в приложении будет на паузе 1–2 минуты. Просмотр работает, введённое сотрудники не потеряют: приложение повторит отправку.'));
      const count = el('p', 'sw-count', '10');
      count.setAttribute('aria-live', 'polite');
      form.append(count);
      form.append(el('p', 'muted', 'Кнопка «Переключить» включится через 10 секунд. Отмена доступна сразу.'));
      const err = el('p', 'cc-fail'); err.hidden = true;
      const acts = el('div', 'dialog-actions');
      const go = el('button', 'btn btn-primary', 'Подождите 10 с'), no = el('button', 'btn', 'Отмена');
      go.type = no.type = 'button';
      go.disabled = true;
      let left = 10;
      no.addEventListener('click', () => { closeConfirm(); if (lastBtn && lastBtn.isConnected) lastBtn.focus(); });
      go.addEventListener('click', async () => {
        if (go.disabled) return;
        go.classList.add('is-busy'); err.hidden = true;
        try { await post('/control/switch/start', { confirm: true }); closeConfirm(); toast('Переключение началось'); await load(); }
        catch (e) { err.textContent = failText(e, 'Переключение'); err.hidden = false; go.classList.remove('is-busy'); }
      });
      acts.append(no, go);
      form.append(err, acts);
      dlg.replaceChildren(form);
      dlg.showModal();
      no.focus();
      countTimer = setInterval(() => {
        left -= 1;
        if (left > 0) { count.textContent = String(left); go.textContent = 'Подождите ' + left + ' с'; return; }
        stopCount();
        count.textContent = '0';
        go.disabled = false;
        go.textContent = 'Переключить';
        go.focus();
      }, 1000);
    }

    function confirmRefresh(btn, scope) {
      lastBtn = btn || null;
      closeConfirm();
      const to = data.self === 'home' ? NAME.office : NAME.home;
      const form = el('form', 'dialog-form');
      form.addEventListener('submit', (e) => e.preventDefault());
      const dataOnly = scope === 'data';
      form.append(el('h3', '', dataOnly ? 'Обновить данные запасного' : 'Обновить код и данные запасного'));
      form.append(el('p', '', 'На сервере «' + to + '» обновятся ' + (dataOnly ? 'данные.' : 'код и данные.')));
      form.append(el('p', 'cc-note warn', 'Во время обновления запись может быть на паузе. Переключение домена требует отдельного подтверждения.'));
      const err = el('p', 'cc-fail'); err.hidden = true;
      const acts = el('div', 'dialog-actions');
      const go = el('button', 'btn btn-primary', 'Обновить'), no = el('button', 'btn', 'Отмена');
      go.type = no.type = 'button';
      no.addEventListener('click', () => { closeConfirm(); if (lastBtn && lastBtn.isConnected) lastBtn.focus(); });
      go.addEventListener('click', async () => {
        if (go.classList.contains('is-busy')) return;
        go.classList.add('is-busy'); err.hidden = true;
        try { await post('/control/switch/refresh', { confirm: true, scope }); closeConfirm(); toast('Обновление началось'); await load(); }
        catch (e) { err.textContent = failText(e, 'Обновление'); err.hidden = false; go.classList.remove('is-busy'); }
      });
      acts.append(no, go);
      form.append(err, acts);
      dlg.replaceChildren(form);
      dlg.showModal();
      no.focus();
    }

    function confirmEmergency(btn) {
      openDrawer('Аварийное включение', (b) => {
        b.append(el('p', 'cc-note warn', 'Главный сервер не отвечает. Этот сервер станет главным с данными на момент последнего бэкапа. Всё, что записано позже, будет потеряно.'));
        b.append(el('p', '', 'Копия на этом сервере: ' + ageText(data.copyAgeMin != null ? data.copyAgeMin : (data.peer || {}).copyAgeMin) + '.'));
        const inp = el('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Введите фразу ' + PHRASE);
        inp.placeholder = PHRASE;
        b.append(el('p', '', 'Чтобы продолжить, введите фразу «' + PHRASE + '».'), inp);
        const err = el('p', 'cc-fail'); err.hidden = true;
        const acts = el('div', 'cc-acts');
        const go = el('button', 'btn btn-danger', 'Включить этот сервер как главный'), no = el('button', 'btn', 'Отмена');
        go.type = no.type = 'button'; go.disabled = true; no.addEventListener('click', closeDrawer);
        inp.addEventListener('input', () => { go.disabled = inp.value.trim() !== PHRASE; });
        go.addEventListener('click', async () => {
          if (inp.value.trim() !== PHRASE) return;
          go.classList.add('is-busy'); err.hidden = true;
          try { await post('/control/switch/emergency', { confirm: PHRASE }); closeDrawer(); toast('Аварийное включение запущено'); await load(); }
          catch (e) { err.textContent = failText(e, 'Включение'); err.hidden = false; go.classList.remove('is-busy'); }
        });
        acts.append(go, no); b.append(err, acts);
      }, btn);
    }

    function hereName(d) {
      if (d.self === 'home' || d.self === 'office') return d.self;
      return d.selfIsCopy ? 'office' : 'home';
    }

    function isMainCol(name, d) {
      if (d.enabled === false) {
        const mine = name === hereName(d);
        return mine ? !d.selfIsCopy : !!d.selfIsCopy;
      }
      return name === d.self ? d.role === 'main' : d.role === 'standby';
    }

    function stats(name, d) {
      const s = (d.speed && d.speed[name]) || {};
      const sec = el('section', 'sw-stats');
      sec.append(el('h3', '', 'Скорость'));
      const has = s.p50 != null || s.p95 != null || s.requests != null || s.probeMs != null
        || (hereName(d) === name && screenMs != null);
      if (!has) {
        sec.append(el('p', 'muted', 'Замеров пока нет — сравнение появится после первых запросов.'));
        return sec;
      }
      const rows = el('dl', 'sw-kv');
      const row = (k, v) => { rows.append(el('dt', '', k), el('dd', 'num', v)); };
      row('Обычный ответ', s.p50 == null ? 'нет данных' : 'до ' + s.p50 + ' мс');
      row('Почти все запросы', s.p95 == null ? 'нет данных' : 'до ' + s.p95 + ' мс');
      row('Медленнее 1 с', s.requests == null ? 'нет данных' : (s.slow || 0) + ' из ' + s.requests);
      if (hereName(d) === name) row('Отклик экрана', screenMs == null ? 'нет данных' : screenMs + ' мс');
      else row('Отклик проверки', s.probeMs == null ? 'нет данных' : s.probeMs + ' мс');
      sec.append(rows);
      return sec;
    }

    function verdict(d) {
      const h = d.speed && d.speed.home ? d.speed.home.p50 : null;
      const o = d.speed && d.speed.office ? d.speed.office.p50 : null;
      const p = el('p', 'sw-verdict');
      if (h == null || o == null) p.textContent = 'Сравнить скорость пока нельзя: нет замера с одного из серверов.';
      else if (h === o) p.textContent = 'По обычному ответу оба сервера сейчас одинаковы: до ' + h + ' мс.';
      else {
        const homeFaster = h < o;
        p.textContent = (homeFaster ? 'Домашний' : 'Офисный') + ' обрабатывает запросы быстрее: обычно до ' + Math.min(h, o) + ' мс, ' + (homeFaster ? 'офисный' : 'домашний') + ' — до ' + Math.max(h, o) + ' мс.';
      }
      return p;
    }

    function switchSlot(name, d) {
      const wrap = el('div', 'sw-act');
      if (isMainCol(name, d)) {
        wrap.append(el('p', 'muted', d.enabled === false
          ? 'Сейчас этот сервер считается главным.'
          : 'Этот сервер главный. Если переключить, запись встанет на паузу на 1–2 минуты.'));
        return wrap;
      }
      // Пока переключение не включено — без кнопки: иначе «Сделать главным» рядом с «ещё не готово».
      if (d.enabled === false) {
        wrap.append(el('p', 'muted', 'Кнопка «Сделать главным» появится после настройки переключения (см. ниже).'));
        return wrap;
      }
      const busy = running(d.job);
      const manual = el('div', 'cc-acts');
      for (const [scope, label] of [['data', 'Запустить данные сейчас'], ['both', 'Обновить код и данные сейчас']]) {
        const up = el('button', 'btn', label);
        up.type = 'button';
        up.disabled = !d.canRefresh || busy;
        up.addEventListener('click', () => confirmRefresh(up, scope));
        manual.append(up);
      }
      const go = el('button', 'btn btn-primary', 'Сделать главным');
      go.type = 'button';
      go.disabled = !d.canStart || busy;
      go.addEventListener('click', () => confirmStart(go));
      const update = el('div', 'sw-phase');
      update.append(el('h3', '', 'Ручное обновление запасного'), manual);
      wrap.append(update, go);
      if (busy) wrap.append(el('p', 'muted', isRefresh(d.job) ? 'Идёт обновление, подождите.' : 'Идёт переключение, подождите.'));
      else if (d.role === 'standby') wrap.append(el('p', 'muted', 'Команды доступны с главного сервера.'));
      else if (!d.canRefresh) wrap.append(el('p', 'muted', 'Сейчас обновить нельзя.'));
      return wrap;
    }

    function split(d) {
      const grid = el('div', 'sw-split');
      ['home', 'office'].forEach((name) => {
        const col = el('section', 'sw-half');
        col.setAttribute('aria-label', NAME[name]);
        col.append(card(name, d), switchSlot(name, d), stats(name, d));
        grid.append(col);
      });
      return grid;
    }

    function draw() {
      const d = data;
      if (!d) return;
      const parts = [split(d), technicalCheck(el, d, ageText), verdict(d)];
      if (d.mode === 'readonly' && !running(d.job)) parts.push(el('p', 'cc-note warn', 'Этот сервер сейчас в режиме «только чтение»: запись на паузе.'));
      if (d.job) parts.push(progress(d.job));
      if (d.canEmergency) {
        const z = el('div', 'sw-danger');
        z.append(el('h3', '', 'Главный сервер не отвечает?'), el('p', 'muted', 'Можно включить этот сервер как главный. Данные будут на момент последнего бэкапа.'));
        const eb = el('button', 'btn btn-danger', 'Аварийное включение'); eb.type = 'button';
        eb.addEventListener('click', () => confirmEmergency(eb));
        z.append(eb); parts.push(z);
      }
      if (d.enabled !== false) parts.push(el('p', 'muted sw-hint', 'Если главный сервер упал, этот экран открывается по прямому адресу второго сервера.'));
      box.replaceChildren(...parts);
    }

    async function load() {
      if (!alive()) return;
      const my = ++token;
      clearTimeout(timer);
      try {
        const t0 = performance.now();
        const status = await api('/control/switch');
        if (my !== token || !alive()) return;
        data = status;
        screenMs = Math.round(performance.now() - t0);
      } catch (e) {
        if (my !== token || !alive()) return;
        void schedule.reload(false);
        if (e.status === 404) { data = { enabled: false }; draw(); return; }
        box.replaceChildren(el('p', 'cc-fail', e.status === 403 ? 'Этот раздел доступен только администратору.' : 'Не удалось получить состояние серверов. ' + (e.message || '')));
        timer = setTimeout(load, SLOW);
        return;
      }
      draw();
      void schedule.reload(data.enabled !== false);
      timer = setTimeout(load, running(data.job) ? FAST : SLOW);
    }
    const { create, technicalCheck } = window.dcSwitchSchedule;
    const schedule = create({ api, el, toast, openDrawer, closeDrawer, onSaved: load, alive });
    shell.append(schedule.node);
    load();
  }
  window.dcSwitch = { open };
})();
