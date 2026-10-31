/* Вкладка «Серверы» (SW-4): какой сервер главный, кнопка «Переключить сейчас», аварийное включение. Классический скрипт, без библиотек.
   Подключается до admin.js; admin.js зовёт window.dcSwitch.open(корень, { api, el, toast }). Тексты — только через textContent. */
(function () {
  'use strict';
  const STEPS = [
    ['preflight', 'Проверка'], ['readonly', 'Пауза записи'], ['dump', 'Копия базы'], ['restore', 'Передача на второй сервер'], ['photos', 'Фото'],
    ['verify', 'Сверка'], ['promote', 'Запуск второго'], ['vps', 'Переключение домена'], ['finish', 'Готово'],
  ];
  const STEP_RU = Object.fromEntries(STEPS);
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
    const box = el('div', 'sw-box');
    const back = el('div', 'sw-back'), drawer = el('aside', 'sw-drawer');
    drawer.setAttribute('role', 'dialog'); drawer.hidden = back.hidden = true;
    root.replaceChildren(box, back, drawer);
    const alive = () => root.isConnected && !(root.closest('.tab-panel') || {}).hidden;
    let data = null, token = 0, lastBtn = null;

    const closeDrawer = () => { drawer.hidden = back.hidden = true; drawer.replaceChildren(); if (lastBtn && lastBtn.isConnected) lastBtn.focus(); };
    back.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && root.isConnected) closeDrawer(); });

    function openDrawer(title, build, btn) {
      lastBtn = btn || null;
      drawer.setAttribute('aria-label', title);
      const head = el('div', 'cc-dhead'), t = el('div', 'cc-dt'), x = el('button', 'btn btn-sm', 'Закрыть');
      t.append(el('h2', '', title)); x.type = 'button'; x.addEventListener('click', closeDrawer); head.append(t, x);
      const body = el('div', 'cc-dbody');
      build(body);
      drawer.replaceChildren(head, body); drawer.hidden = back.hidden = false;
      const f = body.querySelector('input,button'); if (f) f.focus();
    }

    const failText = (e, what) => {
      if (e.status === 409) return 'Переключение уже идёт, или этот сервер сейчас не главный. Обновите экран.';
      if (e.status === 503) return 'Нет связи со служебным мостом на сервере. ' + what + ' не начато.';
      if (e.status === 403) return 'Это действие доступно только администратору.';
      return e.message || 'Не получилось. Попробуйте ещё раз.';
    };

    function card(name, d) {
      const mine = d.self === name;
      const main = mine ? d.role === 'main' : d.role === 'standby';
      const c = el('section', 'sw-card' + (main ? ' main' : '') + (mine ? ' mine' : ''));
      const h = el('div', 'sw-ch');
      h.append(el('h3', '', NAME[name]), el('span', 'sw-tag ' + (main ? 'ok' : ''), main ? 'Главный' : 'Запасной'));
      if (mine) h.append(el('span', 'sw-tag you', 'Вы здесь'));
      const rows = el('dl', 'sw-kv');
      const row = (k, v, cls) => { rows.append(el('dt', '', k), el('dd', cls || '', v)); };
      if (mine) {
        row('Работает', d.mode === 'readonly' ? 'Запись на паузе' : 'Да, в обычном режиме', d.mode === 'readonly' ? 'warn' : 'ok');
      } else {
        const p = d.peer || {};
        row('Работает', p.healthy ? 'Да' : 'Не отвечает', p.healthy ? 'ok' : 'bad');
        row('Версия', p.version || 'нет данных');
        row('Копия базы', ageText(p.copyAgeMin));
        if (p.checkedAt) row('Проверен', new Date(p.checkedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
      }
      c.append(h, rows);
      return c;
    }

    function progress(j) {
      const w = el('div', 'sw-job');
      const idx = Math.max(0, STEPS.findIndex((s) => s[0] === j.step));
      const head = j.state === 'done' ? 'Переключение завершено' : j.state === 'failed' ? 'Переключение не завершилось' : 'Идёт переключение';
      w.append(el('h3', 'sw-jt' + (j.state === 'failed' ? ' bad' : j.state === 'done' ? ' ok' : ''), head));
      const ol = el('ol', 'sw-steps');
      STEPS.forEach(([id, label], i) => {
        let st = 'todo';
        if (j.state === 'done' || i < idx) st = 'done';
        else if (i === idx) st = j.state === 'failed' ? 'fail' : 'now';
        const li = el('li', 'sw-step ' + st);
        li.append(el('span', 'sw-mark', st === 'done' ? '✓' : st === 'fail' ? '!' : st === 'now' ? '…' : String(i + 1)), el('span', '', label));
        ol.append(li);
      });
      w.append(ol);
      if (j.state === 'failed') {
        const f = el('div', 'cc-fail');
        f.append(el('strong', '', 'Остановилось на шаге «' + (STEP_RU[j.step] || j.step || '—') + '».'));
        f.append(el('p', '', j.error ? String(j.error) : 'Причина не указана.'));
        f.append(el('p', '', 'Проверьте состояние серверов выше. Если запись осталась на паузе, повторите переключение.'));
        w.append(f);
      }
      return w;
    }

    function confirmStart(btn) {
      openDrawer('Переключить сервер', (b) => {
        const to = data.self === 'home' ? NAME.office : NAME.home;
        b.append(el('p', '', 'Главным станет сервер «' + to + '».'));
        b.append(el('p', 'cc-note warn', 'Запись в приложении будет на паузе 1–2 минуты. Просмотр работает, введённое сотрудники не потеряют: приложение повторит отправку.'));
        const err = el('p', 'cc-fail'); err.hidden = true;
        const acts = el('div', 'cc-acts');
        const go = el('button', 'btn btn-primary', 'Переключить сейчас'), no = el('button', 'btn', 'Отмена');
        go.type = no.type = 'button'; no.addEventListener('click', closeDrawer);
        go.addEventListener('click', async () => {
          go.classList.add('is-busy'); err.hidden = true;
          try { await post('/control/switch/start', { confirm: true }); closeDrawer(); toast('Переключение началось'); await load(); }
          catch (e) { err.textContent = failText(e, 'Переключение'); err.hidden = false; go.classList.remove('is-busy'); }
        });
        const hint = el('p', 'muted', 'Введите фразу: кнопка станет активной.');
        inp.addEventListener('input', () => { hint.hidden = inp.value.trim() === PHRASE; });
        acts.append(go, no); b.append(err, hint, acts);
      }, btn);
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

    function draw() {
      const d = data;
      if (!d) return;
      if (d.enabled === false) { box.replaceChildren(el('p', 'cc-note', 'Переключение ещё не включено на этом сервере. Оно включается настройкой сервера; пока всё работает как раньше.')); return; }
      const cards = el('div', 'sw-cards');
      cards.append(card('home', d), card('office', d));
      const parts = [cards];
      if (d.mode === 'readonly' && !running(d.job)) parts.push(el('p', 'cc-note warn', 'Этот сервер сейчас в режиме «только чтение»: запись на паузе.'));
      if (d.job) parts.push(progress(d.job));
      const acts = el('div', 'cc-acts');
      const go = el('button', 'btn btn-primary', 'Переключить сейчас'); go.type = 'button';
      const busy = running(d.job);
      go.disabled = !d.canStart || busy;
      go.addEventListener('click', () => confirmStart(go));
      acts.append(go);
      if (busy) acts.append(el('span', 'muted', 'Идёт переключение, подождите.'));
      else if (!d.canStart) acts.append(el('span', 'muted', d.role === 'standby' ? 'Кнопка доступна на главном сервере.' : d.bridge && !d.bridge.alive ? 'Нет связи со служебным мостом.' : 'Сейчас переключить нельзя.'));
      parts.push(acts);
      if (d.bridge && !d.bridge.alive) parts.push(el('p', 'cc-note warn', 'Служебный мост на сервере не отвечает: переключение недоступно, пока его не запустят.'));
      if (d.canEmergency) {
        const z = el('div', 'sw-danger');
        z.append(el('h3', '', 'Главный сервер не отвечает?'), el('p', 'muted', 'Можно включить этот сервер как главный. Данные будут на момент последнего бэкапа.'));
        const eb = el('button', 'btn btn-danger', 'Аварийное включение'); eb.type = 'button';
        eb.addEventListener('click', () => confirmEmergency(eb));
        z.append(eb); parts.push(z);
      }
      parts.push(el('p', 'muted sw-hint', 'Если главный сервер упал, этот экран открывается по прямому адресу второго сервера.'));
      box.replaceChildren(...parts);
    }

    async function load() {
      const my = ++token;
      clearTimeout(timer);
      try {
        data = await api('/control/switch');
      } catch (e) {
        if (my !== token) return;
        if (e.status === 404) { data = { enabled: false }; draw(); return; }
        box.replaceChildren(el('p', 'cc-fail', e.status === 403 ? 'Этот раздел доступен только администратору.' : 'Не удалось получить состояние серверов. ' + (e.message || '')));
        if (alive()) timer = setTimeout(load, SLOW);
        return;
      }
      if (my !== token) return;
      draw();
      if (alive()) timer = setTimeout(load, running(data.job) ? FAST : SLOW);
    }
    load();
  }
  window.dcSwitch = { open };
})();
