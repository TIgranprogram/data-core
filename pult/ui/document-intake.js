const endpoint = '/api/document-intake/';
const production = 'https://kppdf-crm.ru/db/api';
const defaultModel = 'google/gemma-4-12b-qat';
const folderLabels = { inbox: 'Входящие', processing: 'Разбираются', ready: 'Готово', question: 'Сомнительные' };

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
  const selectedQuestions = new Set();
  let selectionRoot = '';
  let questionChoices = [];

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
  const progress = el('progress', 'intake-progress');
  progress.setAttribute('aria-label', 'Ход разбора документов');
  const statList = el('dl', 'intake-counts');
  const statValues = Object.entries(folderLabels).map(([key, label]) => {
    const item = el('div');
    const value = el('dd', '', '—');
    item.append(el('dt', '', label), value);
    statList.append(item);
    return [key, value];
  });
  const run = button('Разобрать', () => perform('run', {}, mainFeedback), 'primary act-go');
  const resume = button('Возобновить', () => perform('resume', {}, mainFeedback), 'primary act-go');
  const stop = button('Остановить', () => perform('stop', {}, mainFeedback), 'ghost danger');
  main.append(card('Ход разбора', statList, statusText, progress, current, actionRow(run, resume, stop, reportButton), mainFeedback));

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
  const openQuestions = button('Открыть сомнительные', () => perform('question', {}, reportStatus));
  const retrySelected = button('Повторить выбранные', () => perform('retry', { arrivalIds: [...selectedQuestions] }, reportStatus), 'primary act-go');
  const sideReport = el('section', 'intake-pane');
  sideReport.append(el('h2', '', 'Отчёт разбора'), reportTime, actionRow(openQuestions, retrySelected), reportStatus, reportItems);
  sideSettings.hidden = true;
  sideReport.hidden = true;
  side.append(actionRow(settingsButton, sideReportButton), sideSettings, sideReport);

  const formatClock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const reportKey = () => JSON.stringify([view?.settings.root, view?.counts, view?.running, view?.progress?.state === 'stopped']);

  function showPane(next) {
    pane = next;
    sideSettings.hidden = next !== 'settings';
    sideReport.hidden = next !== 'report';
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
    const canResume = stalled || !!view?.counts?.processing;
    folder.disabled = !view || busy || running;
    inbox.disabled = !settings?.root || !!pending;
    run.disabled = !canStart;
    run.className = canResume || running ? 'ghost' : 'primary act-go';
    resume.disabled = !canStart || !canResume;
    resume.className = canResume && !running ? 'primary act-go' : 'ghost';
    stop.hidden = !running;
    stop.disabled = !!pending || !view?.canStop;
    openQuestions.hidden = !view?.counts?.question;
    openQuestions.disabled = !!pending;
    retrySelected.hidden = !view?.counts?.question;
    retrySelected.disabled = !canStart || !selectedQuestions.size;
    for (const choice of questionChoices) choice.disabled = !canStart;
    for (const control of [apiBase.input, modelBase.input, model.input, useProduction, useDevelopment, save, username.input, password.input, login, logout]) control.disabled = !view || busy || running;
    login.disabled ||= !settings?.apiBase;
    path.textContent = settings?.root || (view ? 'Выберите папку, в которой будут храниться документы.' : 'Загружаем настройки…');
    path.title = settings?.root || '';
    targetName.textContent = settings?.apiBase === production ? 'Рабочий сайт' : settings?.apiBase ? 'Локальная копия' : 'Адрес сайта не настроен';
    targetDetail.textContent = settings?.apiBase || 'Укажите адрес сайта и модель в настройках.';
    target.classList.toggle('production', settings?.apiBase === production);
    for (const [key, value] of statValues) value.textContent = view?.counts[key] ?? '—';
    const job = view?.progress;
    statusText.classList.toggle('warn', stalled);
    if (pending === 'folder') statusText.textContent = 'Выберите папку в открывшемся окне Windows.';
    else if (running && job?.state === 'stopping') statusText.textContent = job.message;
    else if (running) statusText.textContent = job?.total ? `Обработано ${job.processed} из ${job.total}` : 'Готовим документы к разбору…';
    else if (stalled) statusText.textContent = job.message;
    else if (view?.counts?.processing) statusText.textContent = 'Есть незавершённые документы. Нажмите «Возобновить».';
    else if (!settings?.root) statusText.textContent = view ? 'Начните с выбора папки.' : '';
    else if (!settings.apiBase || !settings.model) statusText.textContent = 'Сохраните адрес сайта и параметры своей локальной модели.';
    else if (!view.signedIn) statusText.textContent = 'Войдите в учётную запись менеджера в настройках.';
    else if (job?.state === 'finished') statusText.textContent = job.total ? `Разбор завершён. Обработано ${job.processed} из ${job.total}.` : 'Разбор завершён. Результаты доступны в отчёте.';
    else statusText.textContent = 'Положите файлы во входящие. Перед разбором запустите выбранную модель в LM Studio.';
    progress.hidden = !running;
    if (job?.total) { progress.max = job.total; progress.value = job.processed; }
    else progress.removeAttribute('value');
    current.textContent = running && job?.current ? job.current : '';
    current.hidden = !current.textContent;
    if (settings) {
      if (selectionRoot !== settings.root) { selectionRoot = settings.root; selectedQuestions.clear(); }
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
        if (item.state === 'question' && item.arrivalId) {
          const label = el('label', 'intake-review-choice');
          const choice = el('input'); choice.type = 'checkbox'; choice.checked = selectedQuestions.has(item.arrivalId);
          choice.setAttribute('aria-label', `Повторить: ${item.name}`);
          choice.onchange = () => { if (choice.checked) selectedQuestions.add(item.arrivalId); else selectedQuestions.delete(item.arrivalId); update(); };
          label.append(choice, el('strong', '', item.name)); row.append(label); questionChoices.push(choice);
        } else row.append(el('strong', '', item.name));
        const result = item.outcome === 'duplicate' ? 'Уже был учтён' : item.state === 'ready' ? 'Учтён' : item.state === 'processing' ? 'Разбирается' : '';
        if (result) row.append(el('p', 'intake-row-result', result));
        if (item.message && (detail || !result)) row.append(el('p', '', item.message));
        if (item.action) row.append(el('p', 'intake-next-action', item.action));
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
    const key = reportKey();
    if (!force && key === lastReportKey) return;
    lastReportKey = key;
    const request = ++reportRequest;
    try {
      const report = await call('report');
      if (reportRequest !== request) return;
      reportTime.textContent = `Обновлено в ${formatClock()}`;
      reportStatus.textContent = report.stopped || '';
      const exceptions = report.items.filter((item) => item.state === 'question');
      const incomplete = report.items.filter((item) => item.state === 'processing');
      const ready = report.items.filter((item) => item.state === 'ready');
      const available = new Set(exceptions.map(item => item.arrivalId));
      for (const id of selectedQuestions) if (!available.has(id)) selectedQuestions.delete(id);
      questionChoices = [];
      const groups = [];
      if (exceptions.length) groups.push(reportGroup('Нужна проверка', exceptions, true));
      if (incomplete.length) groups.push(reportGroup('В работе', incomplete, true));
      if (ready.length) groups.push(reportGroup('Готово', ready));
      if (!groups.length) groups.push(el('p', 'intake-updated', view.settings.root ? 'Результаты появятся после разбора документов.' : 'Выберите папку, чтобы открыть её отчёт.'));
      reportItems.replaceChildren(...groups);
      update();
    } catch (error) {
      if (reportRequest !== request) return;
      lastReportKey = '';
      reportStatus.textContent = error.message;
    }
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
      if (action === 'retry') selectedQuestions.clear();
      if (action === 'run' || action === 'resume' || action === 'retry') showPane('report');
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
