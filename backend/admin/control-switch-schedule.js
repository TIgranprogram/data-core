/* Расписания и техническая проверка на вкладке «Серверы». Классический скрипт для админки. */
(function () {
  'use strict';

  const PATH = '/control/switch/schedule';
  const TZ = 'Europe/Moscow';
  const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const SHORT_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const TITLES = { data: 'Данные', code: 'Код и данные' };
  const STATES = { queued: 'В очереди', running: 'Выполняется', done: 'Успешно', failed: 'Ошибка' };
  const DATE = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const ms = (value) => value ? Date.parse(value) : NaN;
  const dateText = (value, fallback) => Number.isFinite(ms(value)) ? DATE.format(ms(value)) : fallback;
  const validTime = (value) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
  const validInterval = (value) => Number.isInteger(value) && value >= 5 && value <= 1440;

  function planText(plan) {
    if (!plan.enabled) return 'На паузе';
    if (plan.mode === 'interval') return 'Интервал ' + plan.intervalMinutes + ' мин';
    const days = plan.days.length === 7 ? 'Ежедневно' : plan.days.map((day) => SHORT_DAYS[day - 1]).join(', ');
    return days + ' в ' + plan.time + ' МСК';
  }

  const row = (el, list, title, value, cls) => list.append(el('dt', '', title), el('dd', cls || '', value));

  function technicalCheck(el, data, ageText) {
    const section = el('section', 'sw-stats');
    section.append(el('h2', '', 'Техническая проверка'));
    const domain = data.domain || {};
    const checked = ms(domain.checkedAt);
    const known = Number.isFinite(checked);
    const owner = known && { home: 'домашний сервер', office: 'офисный сервер' }[domain.owner];
    section.append(el('h3', '', owner ? 'Домен сейчас направлен на ' + owner : 'Куда направлен домен, пока неизвестно'));
    const list = el('dl', 'sw-kv');
    for (const [server, label] of [['home', 'До домашнего сервера'], ['office', 'До офисного сервера']]) {
      const healthy = known ? domain[server + 'Healthy'] : null;
      row(el, list, label + ' с VPS', healthy == null ? 'Неизвестно' : healthy ? 'Доступен' : 'Недоступен',
        healthy == null ? 'warn' : healthy ? 'ok' : 'bad');
    }
    row(el, list, 'Последняя проверка с VPS', known ? ageText(Math.max(0, Date.now() - checked) / 60000) : 'Проверка ожидается');
    const readiness = data.switchReadiness || {};
    const readyText = { ready: 'Технические условия выполнены', blocked: 'Переключение пока недоступно', unknown: 'Готовность пока неизвестна' };
    row(el, list, 'Состояние', readyText[readiness.state] || readyText.unknown, readiness.state === 'ready' ? 'ok' : 'warn');
    section.append(list);
    const reasons = readiness.reasons || data.blockers || [];
    if (reasons.length) {
      const details = el('ul', 'cc-lines');
      reasons.forEach((reason) => details.append(el('li', '', reason)));
      section.append(details);
    }
    section.append(el('p', 'muted', 'Смена домена выполняется отдельно. Полный прогон обоих направлений требует отдельной проверки.'));
    return section;
  }

  function resultBlock(el, kind, plan, run) {
    const block = el('section', 'sw-half');
    block.append(el('h3', '', TITLES[kind]));
    const list = el('dl', 'sw-kv');
    row(el, list, 'График', planText(plan));
    row(el, list, 'Следующий запуск', plan.enabled ? dateText(run.nextRunAt, 'Пока не запланирован') : 'На паузе');
    row(el, list, 'Последняя попытка', dateText(run.lastAttemptAt, 'Ещё не было'));
    row(el, list, 'Последний успех', dateText(run.lastSuccessAt, 'Ещё не было'));
    row(el, list, 'Результат', STATES[run.lastState] || 'Ещё не запускалось',
      run.lastState === 'done' ? 'ok' : run.lastState === 'failed' ? 'bad' : '');
    if (run.lastError) row(el, list, 'Причина ошибки', run.lastError, 'bad');
    if (run.lastWarning) row(el, list, 'Предупреждение', run.lastWarning, 'warn');
    block.append(list);
    return block;
  }

  function field(el, text, input) {
    const label = el('label', 'srv-field', text);
    label.append(input);
    return label;
  }

  function formGroup(el, kind, plan) {
    const section = el('fieldset', 'cc-form');
    const legend = el('legend', '', TITLES[kind]);
    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.checked = plan.enabled;
    const auto = el('label', 'cc-agree');
    auto.append(enabled, el('span', '', 'Включить автоматический запуск'));
    section.append(legend, auto);

    const mode = el('select');
    mode.append(el('option', '', 'По интервалу'), el('option', '', 'По дням недели'));
    mode.options[0].value = 'interval';
    mode.options[1].value = 'daily';
    mode.value = plan.mode || 'daily';
    const modeField = field(el, 'Периодичность', mode);

    const interval = el('input');
    interval.type = 'number';
    interval.min = '5';
    interval.max = '1440';
    interval.step = '1';
    interval.value = plan.intervalMinutes ?? '';
    const intervalField = field(el, 'Интервал, мин (5–1440)', interval);
    if (kind === 'data') section.append(modeField, intervalField);

    const time = el('input');
    time.type = 'time';
    time.value = plan.time;
    const timeField = field(el, 'Время по Москве', time);
    const weekdays = el('fieldset', 'srv-target');
    weekdays.append(el('legend', '', 'Дни недели'));
    const choices = el('div', 'cc-acts');
    const days = DAYS.map((day, index) => {
      const input = el('input');
      input.type = 'checkbox';
      input.value = String(index + 1);
      input.checked = plan.days.includes(index + 1);
      input.setAttribute('aria-label', day);
      const label = el('label', 'cc-agree');
      label.append(input, el('span', '', SHORT_DAYS[index]));
      choices.append(label);
      return input;
    });
    weekdays.append(choices);
    section.append(timeField, weekdays);

    function sync() {
      const needsInterval = enabled.checked && kind === 'data' && mode.value === 'interval';
      const needsDays = enabled.checked && !needsInterval;
      modeField.hidden = mode.disabled = !enabled.checked;
      intervalField.hidden = interval.disabled = !needsInterval;
      timeField.hidden = time.disabled = weekdays.hidden = weekdays.disabled = !needsDays;
    }
    enabled.addEventListener('change', sync);
    mode.addEventListener('change', sync);
    sync();

    function read(previous, error) {
      const minutes = Number(interval.value);
      let chosenDays = days.filter((day) => day.checked).map((day) => Number(day.value));
      if (!interval.disabled && !validInterval(minutes)) return error('Укажите целый интервал от 5 до 1440 минут.', interval);
      if (!time.disabled && !validTime(time.value)) return error('Укажите время по Москве.', time);
      if (!weekdays.disabled && !chosenDays.length) return error('Выберите хотя бы один день недели.', days[0]);
      if (enabled.checked && !chosenDays.length) chosenDays = DAYS.map((_, index) => index + 1);
      const result = { enabled: enabled.checked, time: validTime(time.value) ? time.value : previous.time, days: chosenDays };
      if (kind === 'data') {
        result.mode = mode.value;
        result.intervalMinutes = validInterval(minutes) ? minutes : previous.intervalMinutes;
      }
      return result;
    }
    return { section, read };
  }

  function create({ api, el, toast, openDrawer, closeDrawer, onSaved, alive }) {
    const node = el('section', 'sw-stats');
    node.hidden = true;
    const head = el('div', 'sw-ch');
    const edit = el('button', 'btn btn-primary', 'Настроить расписание');
    edit.type = 'button';
    head.append(el('h2', '', 'Расписание обновлений'), edit);
    const hint = el('p', 'muted', 'Время запусков по Москве (МСК).');
    const notice = el('p', 'cc-note');
    const retry = el('button', 'btn', 'Повторить загрузку');
    retry.type = 'button';
    retry.addEventListener('click', () => void reload());
    const items = el('div', 'sw-split');
    node.append(head, hint, notice, retry, items);
    let current = null, drawn = '', available = false, pending = false, request = 0;
    let loadError = '', saveInProgress = false, updateEditor = () => {};

    function draw() {
      edit.disabled = !current?.canEdit;
      hint.hidden = !current;
      retry.hidden = !loadError || pending;
      notice.textContent = loadError || (current ? current.reason || '' : 'Расписание загружается…');
      notice.hidden = !notice.textContent;
      notice.classList.toggle('warn', !!loadError);
      if (current) {
        const signature = JSON.stringify([current.data, current.code, current.runs]);
        if (signature !== drawn) {
          drawn = signature;
          items.replaceChildren(...['data', 'code'].map((kind) => resultBlock(el, kind, current[kind], current.runs[kind] || {})));
        }
      }
      updateEditor();
    }

    async function reload(enabled = available) {
      available = enabled;
      node.hidden = !enabled;
      if (!enabled) { ++request; pending = false; updateEditor(); return; }
      if (saveInProgress || pending) return;
      const ticket = ++request;
      pending = true;
      draw();
      try {
        const view = await api(PATH);
        if (ticket !== request || !alive()) return;
        current = view;
        loadError = '';
      } catch (error) {
        if (ticket !== request || !alive()) return;
        loadError = error.status === 404 ? 'Настройки расписания на этом сервере недоступны.'
          : 'Не удалось загрузить расписание. ' + (error.message || '');
      } finally {
        if (ticket === request && alive()) { pending = false; draw(); }
      }
    }

    edit.addEventListener('click', () => {
      if (!available || !current?.canEdit) return;
      let base = current, revisionRejected = false;
      openDrawer('Расписание обновлений', (body) => {
        const form = el('form', 'srv-form');
        form.noValidate = true;
        const data = formGroup(el, 'data', base.data), code = formGroup(el, 'code', base.code);
        const error = el('p', 'cc-fail');
        error.hidden = true;
        error.setAttribute('role', 'alert');
        const permission = el('p', 'cc-note warn');
        permission.setAttribute('role', 'status');
        const conflict = el('div', 'cc-note warn');
        const conflictDetails = el('p', '', 'Расписание изменилось после открытия формы. Введённые значения сохранены.');
        conflictDetails.setAttribute('role', 'status');
        const latest = el('p');
        const rebase = el('button', 'btn', 'Продолжить с моими настройками');
        rebase.type = 'button';
        conflict.append(conflictDetails, latest, rebase);
        const actions = el('div', 'cc-acts');
        const save = el('button', 'btn btn-primary', 'Сохранить'), cancel = el('button', 'btn', 'Отмена');
        save.type = 'submit';
        cancel.type = 'button';
        cancel.addEventListener('click', closeDrawer);
        actions.append(save, cancel);
        form.append(el('p', 'muted', 'Время запусков по Москве (МСК).'), data.section, code.section, permission, conflict, error, actions);
        body.append(form);

        const changed = () => current.revision !== base.revision;
        const conflicting = () => revisionRejected || changed();
        function sync() {
          permission.textContent = !available ? 'Настройки расписания сейчас недоступны.'
            : !current.canEdit ? current.reason || 'Сейчас расписание изменить нельзя.' : '';
          permission.hidden = !permission.textContent;
          conflict.hidden = !conflicting();
          const latestText = changed()
            ? 'Сейчас на сервере. Данные: ' + planText(current.data) + '. Код и данные: ' + planText(current.code) + '.'
            : '';
          if (latest.textContent !== latestText) latest.textContent = latestText;
          rebase.textContent = changed() ? 'Продолжить с моими настройками' : 'Проверить текущее расписание';
          rebase.disabled = !available || pending || saveInProgress;
          save.disabled = saveInProgress || !!permission.textContent || conflicting();
          cancel.disabled = data.section.disabled = code.section.disabled = saveInProgress;
          save.classList.toggle('is-busy', saveInProgress);
          save.textContent = saveInProgress ? 'Сохраняем…' : 'Сохранить';
          form.setAttribute('aria-busy', String(saveInProgress));
        }
        updateEditor = () => { if (body.isConnected) sync(); };
        rebase.addEventListener('click', () => {
          if (!changed()) { void reload(); return; }
          base = current;
          revisionRejected = false;
          error.hidden = true;
          sync();
          save.focus();
        });

        const showError = (message, input) => {
          error.textContent = message;
          error.hidden = false;
          if (input) input.focus();
          return null;
        };

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (save.disabled) return;
          error.hidden = true;
          const dataPlan = data.read(base.data, showError);
          if (!dataPlan) return;
          const codePlan = code.read(base.code, showError);
          if (!codePlan) return;
          saveInProgress = true;
          ++request;
          pending = false;
          sync();
          try {
            current = await api(PATH, { method: 'PUT', body: JSON.stringify({
              expectedRevision: base.revision, timezone: TZ, data: dataPlan, code: codePlan,
            }) });
          } catch (failure) {
            saveInProgress = false;
            if (!alive()) return;
            if (failure.body?.code === 'SCHEDULE_REVISION_CONFLICT') {
              revisionRejected = true;
            } else {
              const label = failure.status === 403 ? 'Для сохранения нужны права администратора.' : 'Не удалось сохранить расписание.';
              showError(label + (failure.message ? ' ' + failure.message : ''));
            }
            draw();
            if (failure.status === 409) await reload();
            if (body.isConnected) (conflicting() ? rebase : save).focus();
            return;
          }
          saveInProgress = false;
          if (!alive()) return;
          base = current;
          draw();
          closeDrawer();
          toast('Расписание сохранено');
          onSaved();
        });
        sync();
      }, edit, () => !saveInProgress);
    });
    draw();
    return { node, reload };
  }

  window.dcSwitchSchedule = { create, technicalCheck };
})();
