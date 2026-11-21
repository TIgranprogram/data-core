const endpoint = '/api/document-intake/';
const production = 'https://kppdf-crm.ru/db/api';
const defaultModel = 'google/gemma-4-12b-qat';
const folderLabels = { inbox: 'Входящие', processing: 'Разбираются', checked: 'Проверено локально', question: 'На проверку', uploaded: 'Загруженные' };
const stageLabels = { preparing: 'Подготовка', extracting: 'Чтение PDF', proposing: 'Ответ локальной модели', validating: 'Проверка реквизитов', checked: 'Проверено локально', question: 'Нужна сверка' };

export function createIntakeView({ api, el }) {
  const call = (action, body) => api(endpoint + action, body);
  const button = (title, handler, cls = 'ghost') => {
    const node = el('button', cls, title);
    node.type = 'button';
    node.onclick = handler;
    return node;
  };
  const field = (title, options) => {
    const label = el('label', 'param', title);
    const input = Object.assign(el('input'), options);
    label.append(input);
    return { label, input };
  };
  const feedback = (cls) => {
    const node = el('p', cls);
    node.setAttribute('role', 'status');
    return node;
  };
  const actionRow = (...buttons) => {
    const row = el('div', 'intake-actions');
    row.append(...buttons);
    return row;
  };
  const card = (title, ...children) => {
    const node = el('section', 'card intake-card');
    node.append(el('h2', '', title), ...children);
    return node;
  };

  let visible = false;
  let view = null;
  let pane = '';
  let pending = '';
  let statusRequest = null;
  let refreshAgain = false;
  let lastReportKey = '';
  let reportRequest = 0;
  let persisted = '';
  let savedAddress = '';
  let draftRequest = 0;
  let draftRoot = '';
  let draftButtons = [];
  let preparationKey = '';

  const main = el('div', 'intake-main');
  const side = el('div', 'intake-side-content');
  const path = el('p', 'intake-root', 'Загружаем настройки…');
  const folder = button('Папка…', () => perform('folder', {}, mainFeedback));
  const inbox = button('Открыть входящие', () => perform('inbox', {}, mainFeedback));
  const targetName = el('strong', '', 'Адрес сайта не настроен');
  const targetDetail = el('p', 'intake-target');
  const target = el('div', 'intake-destination');
  const settingsButton = button('Настройки', () => showPane('settings'));
  const reportButton = button('Отчёт', () => showPane('report'));
  const sideReportButton = button('Отчёт', () => showPane('report'));
  target.append(targetName, targetDetail);
  main.append(card('Папка обработки', path, actionRow(folder, inbox)), target);

  const mainFeedback = feedback('intake-feedback');
  const statusText = feedback('intake-status');
  const current = el('p', 'intake-current');
  const activity = el('p', 'intake-updated');
  const progress = el('progress', 'intake-progress');
  progress.setAttribute('aria-label', 'Ход разбора документов');
  const preparation = el('section', 'intake-preparation');
  const preparationSteps = el('ul', 'intake-preparation-steps');
  preparation.append(el('h3', '', 'Подготовка ПК'), preparationSteps);
  preparation.hidden = true;
  const statList = el('dl', 'intake-counts');
  const statValues = Object.entries(folderLabels).map(([key, label]) => {
    const item = el('div');
    const value = el('dd', '', '—');
    item.append(el('dt', '', label), value);
    statList.append(item);
    return [key, value];
  });
  const run = button('Разобрать', () => perform('analyze', {}, mainFeedback), 'primary act-go');
  const resume = button('Возобновить', () => perform('analyze', {}, mainFeedback), 'primary act-go');
  const stop = button('Остановить', () => perform('stop', {}, mainFeedback), 'ghost danger');
  const availability = el('p', 'intake-availability', 'Отправка недоступна до серверной приёмки. Анализ сохраняет только локальные черновики.');
  main.append(card('Ход разбора', statList, statusText, progress, preparation, current, activity, actionRow(run, resume, stop, reportButton), mainFeedback), availability);

  const apiBase = field('Адрес сайта', { type: 'url', required: true, maxLength: 1200, spellcheck: false, placeholder: production });
  const modelBase = field('Адрес LM Studio', { type: 'url', required: true, maxLength: 1200, spellcheck: false });
  const model = field('Название модели', { required: true, maxLength: 160, spellcheck: false });
  const useProduction = button('Рабочий сайт', () => { apiBase.input.value = production; apiBase.input.focus(); });
  const useDevelopment = button('Тестовая копия на этом ПК', () => { apiBase.input.value = 'http://127.0.0.1:3102/api'; apiBase.input.focus(); });
  const save = el('button', 'primary', 'Сохранить настройки');
  const settingsFeedback = feedback('intake-feedback');
  const settingsForm = el('form', 'intake-form');
  settingsForm.append(apiBase.label, actionRow(useProduction, useDevelopment), modelBase.label, model.label, actionRow(save), settingsFeedback);
  settingsForm.onsubmit = (event) => {
    event.preventDefault();
    perform('settings', { apiBase: apiBase.input.value, modelBase: modelBase.input.value, model: model.input.value }, settingsFeedback, 'Настройки сохранены.');
  };

  const username = field('Логин', { required: true, maxLength: 64, autocomplete: 'username' });
  const password = field('Пароль', { type: 'password', required: true, maxLength: 128, autocomplete: 'off' });
  const login = el('button', 'primary', 'Войти');
  const logout = button('Выйти', () => perform('logout', {}, loginFeedback));
  const loginInfo = el('p');
  const loginFeedback = feedback('intake-feedback');
  const loginForm = el('form', 'intake-form');
  loginForm.append(username.label, password.label, actionRow(login));
  loginForm.onsubmit = (event) => {
    event.preventDefault();
    const secret = password.input.value;
    password.input.value = '';
    perform('login', { username: username.input.value, password: secret }, loginFeedback);
  };
  const sideSettings = el('section', 'intake-pane');
  sideSettings.append(card('Подключение', settingsForm), card('Учётная запись менеджера', loginInfo, loginForm, actionRow(logout), loginFeedback));

  const reportTime = el('p', 'intake-updated');
  const reportStatus = feedback('intake-feedback');
  const reportItems = el('div', 'intake-report-items');
  const sideReport = el('section', 'intake-pane');
  sideReport.append(el('h2', '', 'Результаты проверки'), reportTime, reportStatus, reportItems);
  const sideDraft = el('section', 'intake-pane');
  const draftTitle = el('h2', '', 'Сверка документа');
  draftTitle.tabIndex = -1;
  const draftFeedback = feedback('intake-feedback');
  const draftContent = el('div', 'intake-draft-content');
  const backToReport = button('К списку документов', () => { draftRequest++; showPane('report'); });
  sideDraft.append(actionRow(backToReport), draftTitle, draftFeedback, draftContent);
  sideSettings.hidden = true;
  sideReport.hidden = true;
  sideDraft.hidden = true;
  side.append(actionRow(settingsButton, sideReportButton), sideSettings, sideReport, sideDraft);

  const formatClock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const reportKey = () => JSON.stringify([view?.settings.root, view?.reviewCounts, view?.running, view?.progress?.lastEventAt, view?.progress?.state === 'stopped']);

  function showPane(next) {
    pane = next;
    sideSettings.hidden = next !== 'settings';
    sideReport.hidden = next !== 'report';
    sideDraft.hidden = next !== 'draft';
    settingsButton.setAttribute('aria-pressed', String(next === 'settings'));
    sideReportButton.setAttribute('aria-pressed', String(next === 'report'));
    if (next !== 'settings') password.input.value = '';
    if (next === 'report') loadReport(true);
  }

  function update() {
    const settings = view?.settings;
    const running = !!view?.running;
    const busy = !!pending || !!view?.busy;
    const canStart = !!settings?.root && !!settings.apiBase && !!settings.model && !!view.signedIn && !running && !busy;
    const stalled = view?.progress?.state === 'stopped';
    const canResume = stalled || !!view?.reviewCounts?.processing;
    folder.disabled = !view || busy || running;
    inbox.disabled = !settings?.root || !!pending;
    run.disabled = !canStart;
    run.className = canResume || running ? 'ghost' : 'primary act-go';
    resume.disabled = !canStart || !canResume;
    resume.className = canResume && !running ? 'primary act-go' : 'ghost';
    stop.hidden = !running;
    stop.disabled = !!pending || !view?.canStop;
    for (const control of draftButtons) control.disabled = busy || running || !view?.signedIn;
    for (const control of [apiBase.input, modelBase.input, model.input, useProduction, useDevelopment, save, username.input, password.input, login, logout]) control.disabled = !view || busy || running;
    login.disabled ||= !settings?.apiBase;
    path.textContent = settings?.root || (view ? 'Выберите папку, в которой будут храниться документы.' : 'Загружаем настройки…');
    path.title = settings?.root || '';
    targetName.textContent = settings?.apiBase === production ? 'Рабочий сайт' : settings?.apiBase ? 'Локальная копия' : 'Адрес сайта не настроен';
    targetDetail.textContent = settings?.apiBase || 'Укажите адрес сайта и модель в настройках.';
    target.classList.toggle('production', settings?.apiBase === production);
    for (const [key, value] of statValues) value.textContent = view?.reviewCounts?.[key] ?? '—';
    const job = view?.progress;
    statusText.classList.toggle('warn', stalled);
    if (pending === 'folder') statusText.textContent = 'Выберите папку в открывшемся окне Windows.';
    else if (running && job?.state === 'stopping') statusText.textContent = job.message;
    else if (running) statusText.textContent = job?.total ? `Проверено ${job.processed} из ${job.total}` : 'Готовим документы к проверке…';
    else if (stalled) statusText.textContent = job.message;
    else if (view?.reviewCounts?.processing) statusText.textContent = 'Есть локальные черновики. Нажмите «Возобновить», чтобы повторить проверку.';
    else if (!settings?.root) statusText.textContent = view ? 'Начните с выбора папки.' : '';
    else if (!settings.apiBase || !settings.model) statusText.textContent = 'Сохраните адрес сайта и параметры своей локальной модели.';
    else if (!view.signedIn) statusText.textContent = 'Войдите в учётную запись менеджера в настройках.';
    else if (job?.state === 'finished') statusText.textContent = job.total ? `Проверка завершена. Проверено ${job.processed} из ${job.total}.` : 'Проверка завершена. Результаты доступны в отчёте.';
    else statusText.textContent = 'Положите файлы во входящие. Перед разбором запустите выбранную модель в LM Studio.';
    progress.hidden = !running;
    if (job?.total) { progress.max = job.total; progress.value = job.processed; }
    else progress.removeAttribute('value');
    const steps = Array.isArray(view?.preparation?.steps) ? view.preparation.steps : [];
    const nextPreparationKey = JSON.stringify(steps);
    if (preparationKey !== nextPreparationKey) {
      preparationKey = nextPreparationKey;
      preparation.hidden = !steps.length;
      preparationSteps.replaceChildren(...steps.map(step => {
        const row = el('li');
        const status = ['ready', 'checking', 'blocked'].includes(step.status) ? step.status : 'checking';
        const labels = { ready: 'Проверено', checking: 'Проверяется', blocked: 'Нужна подготовка' };
        const heading = el('div', 'intake-preparation-heading');
        heading.append(el('strong', '', typeof step.title === 'string' ? step.title : 'Проверка компонента'), el('span', `intake-preparation-state ${status}`, labels[status]));
        row.append(heading);
        if (typeof step.recovery === 'string' && step.recovery) row.append(el('p', 'intake-next-action', step.recovery));
        return row;
      }));
    }
    current.textContent = running && job?.current ? job.current : '';
    current.hidden = !current.textContent;
    const eventTime = job?.lastEventAt ? new Date(job.lastEventAt) : null;
    const heartbeatTime = job?.heartbeatAt ? new Date(job.heartbeatAt) : null;
    activity.textContent = job ? [stageLabels[job.stage] || '', eventTime && !Number.isNaN(eventTime.valueOf()) ? `Последнее событие: ${eventTime.toLocaleTimeString('ru-RU')}` : '', running && heartbeatTime && !Number.isNaN(heartbeatTime.valueOf()) ? `Связь с процессом: ${heartbeatTime.toLocaleTimeString('ru-RU')}` : ''].filter(Boolean).join(' · ') : '';
    activity.hidden = !activity.textContent;
    if (settings) {
      const binding = JSON.stringify([settings.root, settings.apiBase, view.signedIn]);
      if (draftRoot !== binding) {
        draftRoot = binding;
        draftRequest++; reportRequest++;
        draftContent.replaceChildren(); draftTitle.textContent = 'Сверка документа'; draftFeedback.textContent = '';
        reportItems.replaceChildren(); reportStatus.textContent = ''; reportTime.textContent = '';
        lastReportKey = ''; draftButtons = [];
        if (pane === 'draft') showPane('report');
      }
      const key = JSON.stringify([settings.apiBase, settings.modelBase, settings.model]);
      if (key !== persisted) {
        persisted = key;
        if (savedAddress !== settings.apiBase) password.input.value = '';
        savedAddress = settings.apiBase;
        apiBase.input.value = settings.apiBase;
        modelBase.input.value = settings.modelBase;
        model.input.value = settings.model || defaultModel;
      }
      loginInfo.textContent = view.signedIn ? 'Вход выполнен. После перезапуска пульта войдите снова.' : 'Войдите с логином и паролем менеджера выбранного сайта.';
      loginForm.hidden = view.signedIn;
      logout.hidden = !view.signedIn;
    }
  }

  function reportGroup(title, items, detail = false) {
    const group = el('section', 'intake-report-group');
    group.append(el('h3', '', `${title} · ${items.length}`));
    const list = el('ul', 'intake-report-list');
    const appendRows = (offset) => {
      for (const item of items.slice(offset, offset + 50)) {
        const row = el('li');
        row.append(el('strong', '', item.name));
        const result = item.state === 'checked' ? 'Проверено локально' : item.state === 'question' ? 'На проверку' : item.state === 'uploaded' ? 'Загружен' : 'Разбирается';
        row.append(el('p', `intake-row-result ${item.state === 'question' ? 'needs-review' : ''}`, result));
        for (const issue of item.issues || []) {
          row.append(el('p', '', issue.message || 'Требуется сверка с оригиналом.'));
          if (issue.action) row.append(el('p', 'intake-next-action', issue.action));
        }
        if (item.arrivalId && item.version) {
          const open = button('Сверить', () => loadDraft(item));
          open.setAttribute('aria-label', `Сверить: ${item.name}`);
          draftButtons.push(open); row.append(actionRow(open));
        }
        list.append(row);
      }
      more.hidden = offset + 50 >= items.length;
    };
    const more = button('Показать ещё', () => appendRows(list.childElementCount));
    group.append(list, actionRow(more));
    appendRows(0);
    return group;
  }

  async function loadReport(force = false) {
    if (!visible || pane !== 'report' || !view) return;
    if (!view.settings.root || !view.signedIn) {
      reportRequest++;
      lastReportKey = '';
      reportTime.textContent = '';
      reportStatus.textContent = '';
      reportItems.replaceChildren(el('p', 'intake-updated', !view.settings.root ? 'Выберите папку, чтобы открыть её отчёт.' : 'Войдите в учётную запись менеджера в настройках, чтобы открыть локальные черновики.'));
      return;
    }
    const key = reportKey();
    if (!force && key === lastReportKey) return;
    lastReportKey = key;
    const request = ++reportRequest;
    try {
      const report = await call('reviewreport');
      if (reportRequest !== request) return;
      reportTime.textContent = `Обновлено в ${formatClock()}`;
      reportStatus.textContent = report.stopped || '';
      const exceptions = report.items.filter((item) => item.state === 'question');
      const incomplete = report.items.filter((item) => ['pending', 'extracting', 'proposing'].includes(item.state));
      const checked = report.items.filter((item) => item.state === 'checked');
      const uploaded = report.items.filter((item) => item.state === 'uploaded');
      draftButtons = [];
      const groups = [];
      if (exceptions.length) groups.push(reportGroup('На проверку', exceptions, true));
      if (incomplete.length) groups.push(reportGroup('В работе', incomplete, true));
      if (checked.length) groups.push(reportGroup('Проверено локально', checked));
      if (uploaded.length) groups.push(reportGroup('Загруженные', uploaded));
      if (!groups.length) groups.push(el('p', 'intake-updated', view.settings.root ? 'Результаты появятся после разбора документов.' : 'Выберите папку, чтобы открыть её отчёт.'));
      reportItems.replaceChildren(...groups);
      update();
    } catch (error) {
      if (reportRequest !== request) return;
      lastReportKey = '';
      reportStatus.textContent = error.message;
    }
  }

  async function loadDraft(item) {
    if (pending || view?.running || !view?.signedIn) return;
    const request = ++draftRequest;
    showPane('draft');
    draftTitle.textContent = item.name;
    draftFeedback.textContent = 'Загружаем сохранённые поля и доказательства…';
    draftContent.replaceChildren();
    try {
      const draft = await call('draft', { revision: view.revision, arrivalId: item.arrivalId });
      if (request !== draftRequest || pane !== 'draft') return;
      draftFeedback.textContent = '';
      renderDraft(draft);
      draftTitle.focus();
    } catch (error) {
      if (request === draftRequest) draftFeedback.textContent = error.message;
    }
  }

  function renderDraft(draft) {
    const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : 'Не извлечено';
    const note = el('p', 'intake-updated', `Версия ${draft.version}. Просмотр без изменения. Правка полей станет доступна после серверной проверки.`);
    const issues = el('div', 'intake-draft-issues');
    for (const issue of draft.issues || []) {
      const line = el('div');
      line.append(el('p', 'intake-next-action', issue.message || 'Требуется сверка.'), el('p', '', issue.action || 'Сравните реквизиты с оригиналом.'));
      issues.append(line);
    }
    const evidence = el('section', 'intake-evidence');
    const evidenceTitle = el('h3', '', 'Источник выбранного поля');
    const evidencePage = el('p', 'intake-updated', 'Выберите поле или строку, чтобы увидеть страницу и цитату.');
    const citation = el('blockquote');
    const source = el('details', 'intake-source');
    const sourceTitle = el('summary', '', 'Текст исходной страницы');
    const sourceText = el('pre');
    source.append(sourceTitle, sourceText);
    source.hidden = true;
    evidence.append(evidenceTitle, evidencePage, citation, source);
    const selectors = [];
    const select = (control, label, proof) => {
      for (const selector of selectors) selector.setAttribute('aria-pressed', String(selector === control));
      evidenceTitle.textContent = label;
      const page = Number.isInteger(proof?.page) && proof.page > 0 ? proof.page : null;
      evidencePage.textContent = page ? `Страница ${page}` : 'Страница не подтверждена. Сверьте оригинал.';
      citation.textContent = typeof proof?.quote === 'string' ? proof.quote : 'Цитата отсутствует. Поле требует ручной сверки.';
      const pageText = page && Array.isArray(draft.pages) ? draft.pages[page - 1] : null;
      sourceText.textContent = typeof pageText === 'string' ? pageText : '';
      source.hidden = !sourceText.textContent;
      source.open = false;
      evidence.scrollIntoView({ block: 'nearest' });
    };
    const fields = el('dl', 'intake-draft-fields');
    const addField = (label, value, proof) => {
      const row = el('div');
      const control = button(text(value), () => select(control, label, proof), 'ghost intake-field-value');
      control.setAttribute('aria-label', `Источник поля «${label}»: ${text(value)}`);
      control.setAttribute('aria-pressed', 'false');
      selectors.push(control);
      const content = el('dd'); content.append(control);
      row.append(el('dt', '', label), content); fields.append(row);
    };
    const raw = draft.raw;
    if (raw && typeof raw === 'object') {
      const kinds = { supplier_invoice: 'Счёт поставщика', customer_invoice: 'Счёт покупателю', contract: 'Договор', offer: 'Коммерческое предложение', acceptance: 'Акт', unknown: 'Тип не определён' };
      addField('Тип документа', kinds[raw.kind] || 'Тип не определён', raw.kindEvidence);
      for (const [key, label] of [['number', 'Номер'], ['date', 'Дата'], ['currency', 'Валюта'], ['gross', 'Итог']]) addField(label, raw[key]?.value, raw[key]);
      for (const [key, label] of [['seller', 'Поставщик'], ['buyer', 'Плательщик']]) {
        addField(label, raw[key] ? `${text(raw[key].name)} · ИНН ${text(raw[key].inn)}` : null, raw[key]);
      }
      const vatModes = { none: 'Без НДС', included: 'НДС включён', excluded: 'НДС сверх цены' };
      addField('НДС', raw.vat ? [vatModes[raw.vat.mode] || 'Режим не определён', raw.vat.rate == null ? '' : `${text(raw.vat.rate)}%`, raw.vat.amount == null ? '' : text(raw.vat.amount)].filter(Boolean).join(' · ') : null, raw.vat);
    }
    const lines = el('section', 'intake-draft-lines');
    lines.append(el('h3', '', 'Позиции счёта'));
    if (Array.isArray(raw?.lines) && raw.lines.length) {
      const list = el('ol', 'intake-source-lines');
      for (const [index, line] of raw.lines.entries()) {
        const row = el('li');
        const label = `Позиция ${index + 1}`;
        const control = button(`${text(line?.title)} · ${text(line?.qty)} ${text(line?.unit)} · цена ${text(line?.unitPrice)} · сумма ${text(line?.amount)}`, () => select(control, label, line), 'ghost intake-field-value');
        control.setAttribute('aria-label', `Источник позиции ${index + 1}`);
        control.setAttribute('aria-pressed', 'false'); selectors.push(control);
        row.append(control); list.append(row);
      }
      lines.append(list);
    } else lines.append(el('p', 'intake-updated', 'Позиции не извлечены. Откройте оригинал для сверки.'));
    draftContent.replaceChildren(note, issues, fields, lines, evidence);
  }

  function refresh(forceReport = false) {
    if (!visible) return Promise.resolve();
    if (statusRequest) { refreshAgain = true; return statusRequest; }
    statusRequest = call('status').then((snapshot) => {
      view = snapshot;
      update();
      if (!pane) showPane(snapshot.settings.apiBase && snapshot.signedIn ? 'report' : 'settings');
      else loadReport(forceReport);
    }).catch((error) => { mainFeedback.textContent = error.message; }).finally(() => {
      statusRequest = null;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    });
    return statusRequest;
  }

  async function perform(action, body, message, success = '') {
    if (pending) return;
    pending = action;
    message.textContent = '';
    update();
    try {
      const result = await call(action, { ...body, revision: view?.revision });
      message.textContent = success;
      if (result.cancelled) message.textContent = 'Папка осталась прежней.';
      if (action === 'analyze') showPane('report');
    } catch (error) {
      message.textContent = error.message;
    } finally {
      pending = '';
      await refresh(action === 'folder');
      update();
    }
  }

  update();
  return {
    mount(center, aside) {
      if (center.firstChild !== main) center.replaceChildren(main);
      if (aside.firstChild !== side) aside.replaceChildren(side);
      if (!visible) { visible = true; refresh(true); }
    },
    hide() { visible = false; password.input.value = ''; },
    refresh,
  };
}
