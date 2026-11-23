import { createDocumentImages } from './document-intake-images.js';

const endpoint = '/api/document-intake/';
const production = 'https://kppdf-crm.ru/db/api';
const defaultModel = 'google/gemma-4-12b-qat';
const folderLabels = { inbox: 'Входящие', processing: 'Разбираются', checked: 'Проверено в Пульте', question: 'Нужна сверка', uploaded: 'Отправлено на сайт' };
const kinds = { supplier_invoice: 'Счёт поставщика', customer_invoice: 'Счёт покупателю', contract: 'Договор заказчика', order: 'Заказ покупателя', offer: 'Коммерческое предложение', acceptance: 'Акт' };
const destination = { supplier_invoice: 'Снабжение → Счета', contract: 'Заказы → Договоры заказчиков', offer: 'КП', order: 'Комплект договора заказчика', customer_invoice: 'Комплект договора заказчика', acceptance: 'Комплект договора заказчика' };
const fileStages = [['extracting', 'Чтение PDF'], ['proposing', 'Ожидаем ответ LM Studio'], ['validating', 'Проверка реквизитов'], ['viewing', 'ИИ смотрит страницу PDF']];

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
  let openReview = null;
  let restoreReview = '';
  let reportResultFor = '';
  let draftButtons = [];
  let preparationKey = '';
  let activityTimer = null;

  const main = el('div', 'intake-main');
  const side = el('div', 'intake-side-content');
  const inboxPath = field('Путь к входящим', { readOnly: true });
  inboxPath.label.classList.add('intake-path');
  const folderFeedback = feedback('intake-status');
  const inboxFeedback = feedback('intake-status');
  const folder = button('Папка…', () => perform('folder', {}, folderFeedback));
  const inbox = button('Открыть входящие', () => perform('inbox', {}, inboxFeedback));
  const detach = button('Отключить папку', () => perform('detach', {}, folderFeedback, 'Папка отключена. Файлы остались на диске.'));
  const copyPath = button('Скопировать путь', async () => {
    const value = inboxPath.input.value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      folderFeedback.textContent = 'Путь скопирован.';
    } catch {
      inboxPath.input.focus(); inboxPath.input.select();
      folderFeedback.textContent = 'Нажмите Ctrl+C, чтобы скопировать выделенный путь.';
    }
  });
  const targetName = el('strong', '', 'Адрес сайта не настроен');
  const targetDetail = el('p', 'intake-target');
  const target = el('div', 'intake-destination');
  const settingsButton = button('Настройки', () => showPane('settings'));
  const reportButton = button('Отчёт', () => showPane('report'));
  const sideReportButton = button('Отчёт', () => showPane('report'));
  target.append(targetName, targetDetail);
  main.append(card('Входящие', actionRow(inbox), inboxFeedback), target);

  const mainFeedback = feedback('intake-feedback');
  const statusText = feedback('intake-status');
  const current = el('p', 'intake-current');
  const stages = el('ol', 'intake-file-stages');
  stages.setAttribute('aria-label', 'Этапы разбора файла');
  const stageRows = fileStages.map(([, title]) => el('li', '', title));
  stages.append(...stageRows);
  const elapsed = el('span', 'intake-stage-time');
  const connection = el('span', 'intake-connection');
  const activity = el('div', 'intake-updated intake-activity');
  activity.append(connection, elapsed);
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
  const run = button('Разобрать входящие', () => perform('analyze', { scope: 'incoming' }, mainFeedback), 'primary act-go');
  const stop = button('Остановить', () => perform('stop', {}, mainFeedback), 'ghost danger');
  const prepare = button('Отправить на сайт…', () => delivery('prepare'));
  const autoSend = button('Разобрать и отправить проверенное', () => perform('analyze', { scope: 'incoming', automatic: true }, mainFeedback));
  const deliveryHint = el('p', 'intake-updated');
  main.append(card('Разбор и отправка', statusText, progress, current, stages, activity, preparation, statList, actionRow(run, autoSend, stop, reportButton, prepare), deliveryHint, mainFeedback));

  const apiBase = field('Адрес сайта', { type: 'url', required: true, maxLength: 1200, spellcheck: false, placeholder: production });
  const modelBase = field('Адрес LM Studio', { type: 'url', required: true, maxLength: 1200, spellcheck: false });
  const model = field('Название модели', { required: true, maxLength: 160, spellcheck: false });
  const useProduction = button('Рабочий сайт', () => { apiBase.input.value = production; apiBase.input.focus(); });
  const useDevelopment = button('Тестовая копия на этом ПК', () => { apiBase.input.value = 'http://127.0.0.1:3102/api'; apiBase.input.focus(); });
  const save = el('button', 'primary', 'Сохранить настройки');
  const settingsFeedback = feedback('intake-feedback');
  const modelFeedback = feedback('intake-status');
  const checkModel = button('Проверить LM Studio', () => perform('modelprobe', { modelBase: modelBase.input.value, model: model.input.value }, modelFeedback, 'LM Studio ответила. Модель готова.'));
  const settingsForm = el('form', 'intake-form');
  settingsForm.append(apiBase.label, actionRow(useProduction, useDevelopment), modelBase.label, model.label, actionRow(checkModel, save), modelFeedback, settingsFeedback);
  for (const control of [modelBase.input, model.input]) control.addEventListener('input', () => { modelFeedback.textContent = ''; modelFeedback.classList.remove('intake-model-ready'); });
  settingsForm.onsubmit = (event) => {
    event.preventDefault();
    perform('settings', { apiBase: apiBase.input.value, modelBase: modelBase.input.value, model: model.input.value }, settingsFeedback, 'Настройки сохранены.');
  };

  const username = field('Логин', { value: 'admin', required: true, maxLength: 64, autocomplete: 'username' });
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
  sideSettings.append(card('Папка разбора', inboxPath.label, actionRow(folder, copyPath, detach), folderFeedback),
    card('Подключение', settingsForm), card('Вход в DataCore', loginInfo, loginForm, actionRow(logout), loginFeedback));

  const reportTime = el('p', 'intake-updated');
  const reportStatus = feedback('intake-feedback');
  const reportItems = el('div', 'intake-report-items');
  const reportAction = feedback('intake-feedback');
  const retryReview = button('Повторить проверку сомнительных', () => perform('analyze', { scope: 'review' }, reportStatus));
  const sideReport = el('section', 'intake-pane');
  const confirmation = el('section', 'card intake-card');
  let confirmationId = '';
  const resetConfirmation = () => { confirmationId = ''; confirmation.hidden = true; confirmation.replaceChildren(); };
  resetConfirmation();
  const imageReview = createDocumentImages({ el, button, actionRow, call, getView: () => view,
    canRun: () => !pending && !view?.busy && !view?.running && !!view?.signedIn,
    setBusy: action => { pending = action; update(); }, refresh });
  sideReport.append(el('h2', '', 'Результаты проверки'), confirmation, imageReview.element, retryReview, reportTime, reportStatus, reportAction, reportItems);
  sideSettings.hidden = true;
  sideReport.hidden = true;
  side.append(actionRow(settingsButton, sideReportButton), sideSettings, sideReport);

  const formatClock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const reportKey = () => JSON.stringify([view?.settings.root, view?.reviewCounts, view?.running, view?.progress?.lastEventAt, view?.progress?.state === 'stopped']);

  function showPane(next) {
    pane = next;
    sideSettings.hidden = next !== 'settings';
    sideReport.hidden = next !== 'report';
    if (next !== 'report') { restoreReview = ''; closeReview(); }
    side.closest('.layout')?.classList.toggle('intake-review-open', next === 'report');
    settingsButton.setAttribute('aria-pressed', String(next === 'settings'));
    sideReportButton.setAttribute('aria-pressed', String(next === 'report'));
    if (next !== 'settings') password.input.value = '';
    if (next === 'report') loadReport(true);
  }

  function updateClock() {
    const job = view?.progress;
    const now = Date.now();
    const heartbeat = Date.parse(job?.heartbeatAt || job?.lastEventAt);
    const stale = Number.isFinite(heartbeat) && now - heartbeat > 18_000;
    connection.classList.toggle('is-live', Number.isFinite(heartbeat) && !stale);
    connection.classList.toggle('is-delayed', stale);
    connection.textContent = stale ? 'Пульт давно не обновлялся' : Number.isFinite(heartbeat) ? 'Пульт на связи' : 'Устанавливаем связь';
    const began = Date.parse(job?.lastEventAt);
    const seconds = Math.max(0, Math.floor((now - began) / 1000));
    const clock = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    elapsed.textContent = !stages.hidden && Number.isFinite(began) ? 'На этапе ' + clock : '';
    elapsed.hidden = !elapsed.textContent;
  }

  function update() {
    const settings = view?.settings;
    const running = !!view?.running;
    const busy = !!pending || !!view?.busy;
    const canStart = !!settings?.root && !!settings.apiBase && !!settings.model && !!view.signedIn && !running && !busy;
    const stalled = view?.progress?.state === 'stopped';
    const canResume = !!view?.reviewCounts?.processing;
    const incoming = view?.reviewCounts?.inbox ?? view?.counts?.inbox ?? 0;
    const hasQuestions = !!view?.reviewCounts?.question;
    folder.disabled = !view || busy || running;
    inbox.disabled = !view || !!pending;
    detach.hidden = !settings?.root;
    detach.disabled = busy || running;
    copyPath.disabled = !view?.inboxPath;
    const nextPath = view?.inboxPath || '';
    if (inboxPath.input.value !== nextPath) inboxPath.input.value = nextPath;
    inboxPath.input.title = nextPath;
    prepare.disabled = !canStart || !(view?.reviewCounts?.checked || view?.reviewCounts?.sending);
    run.disabled = !canStart || (!incoming && !canResume);
    run.hidden = running;
    autoSend.hidden = running || !settings?.apiBase || settings.apiBase === production;
    autoSend.disabled = !canStart || (!incoming && !canResume && !view?.reviewCounts?.automatic);
    deliveryHint.textContent = autoSend.hidden ? 'Отправка начинается после подтверждения.'
      : 'Автоотправка проверяет реквизиты и дубли в тестовой копии.';
    run.textContent = canResume ? 'Продолжить разбор' : 'Разобрать входящие';
    retryReview.hidden = !hasQuestions;
    retryReview.disabled = !canStart;
    stop.hidden = !running;
    stop.disabled = !!pending || !view?.canStop;
    for (const control of draftButtons) control.disabled = busy || running || !view?.signedIn;
    for (const control of [apiBase.input, modelBase.input, model.input, useProduction, useDevelopment, checkModel, save, username.input, password.input, login, logout]) control.disabled = !view || busy || running;
    login.disabled ||= !settings?.apiBase;
    targetName.textContent = settings?.apiBase === production ? 'Рабочий сайт' : settings?.apiBase ? 'Локальная копия' : 'Адрес сайта не настроен';
    targetDetail.textContent = settings?.apiBase || 'Укажите адрес сайта и модель в настройках.';
    target.classList.toggle('production', settings?.apiBase === production);
    for (const [key, value] of statValues) value.textContent = view?.reviewCounts?.[key] ?? '—';
    const job = view?.progress;
    statusText.classList.toggle('warn', stalled);
    if (pending === 'folder') statusText.textContent = 'Выберите папку в открывшемся окне Windows.';
    else if (running && job?.state === 'stopping') statusText.textContent = job.message;
    else if (running && job?.stage === 'sending') statusText.textContent = job.message;
    else if (running) statusText.textContent = job?.total ? `Обработано ${job.processed} из ${job.total}` : 'Готовим документы к проверке…';
    else if (stalled) statusText.textContent = job.message;
    else if (view?.reviewCounts?.processing) statusText.textContent = 'Есть незавершённый разбор. Нажмите «Продолжить разбор».';
    else if (!settings?.root) statusText.textContent = view ? 'Откройте входящие и сложите туда PDF.' : '';
    else if (!settings.apiBase || !settings.model) statusText.textContent = 'Сохраните адрес сайта и параметры своей локальной модели.';
    else if (!view.signedIn) statusText.textContent = 'Войдите в DataCore через «Настройки».';
    else if (job?.state === 'finished' && job.message) statusText.textContent = job.message;
    else if (job?.state === 'finished' && job.processed) statusText.textContent = `Обработано ${job.processed} из ${job.total}. ${incoming ? 'Результаты в отчёте.' : 'Входящих PDF нет.'}`;
    else if (!incoming) statusText.textContent = hasQuestions
      ? 'Входящих PDF нет. Сомнительные файлы можно проверить повторно в отчёте.'
      : 'Входящих PDF нет. Положите новые файлы в папку «Входящие».';
    else if (job?.state === 'finished' && job.total && !job.processed) statusText.textContent = 'Файлы ещё не готовы к чтению. Проверьте, завершилось ли копирование.';
    else statusText.textContent = 'Во входящих есть PDF. Нажмите «Разобрать входящие».';
    progress.hidden = !running;
    if (job?.total) { progress.max = job.total; progress.value = job.processed; }
    else progress.removeAttribute('value');
    const steps = Array.isArray(view?.preparation?.steps) ? view.preparation.steps : [];
    preparation.hidden = !steps.length || view?.preparation?.ready === true;
    const nextPreparationKey = JSON.stringify(steps);
    if (preparationKey !== nextPreparationKey) {
      preparationKey = nextPreparationKey;
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
    const stageIndex = fileStages.findIndex(([key]) => key === job?.stage);
    stages.hidden = !running || job?.state === 'stopping' || !job?.current || stageIndex < 0;
    current.textContent = stages.hidden ? '' : (job.total ? `Файл ${Math.min(job.processed + 1, job.total)} из ${job.total} · ` : '') + job.current;
    current.hidden = !current.textContent;
    stageRows.forEach((row, index) => {
      row.classList.toggle('is-done', index < stageIndex);
      if (index === stageIndex) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
    });
    activity.hidden = !running;
    updateClock();
    if (visible && running && !activityTimer) activityTimer = setInterval(updateClock, 1000);
    if (!running && activityTimer) { clearInterval(activityTimer); activityTimer = null; };
    if (settings) {
      const binding = JSON.stringify([settings.root, settings.apiBase, view.signedIn]);
      if (draftRoot !== binding) {
        draftRoot = binding;
        resetConfirmation();
        imageReview.reset();
        closeReview(); reportRequest++;
        reportItems.replaceChildren(); reportStatus.textContent = ''; reportTime.textContent = ''; reportAction.textContent = '';
        lastReportKey = ''; draftButtons = [];
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
      if (view.signedIn) loginInfo.textContent = view.remembered
        ? 'Вход выполнен. Пульт запомнил вход в тестовую копию на этом ПК.'
        : 'Вход выполнен.';
      else loginInfo.textContent = view.remembered
        ? 'Восстановим вход, когда тестовая копия ответит.'
        : 'Войдите с паролем администратора выбранного сайта.';
      loginForm.hidden = view.signedIn;
      logout.hidden = !view.signedIn;
    }
  }

  function partyLabel(kind, field) {
    const invoice = ['supplier_invoice', 'customer_invoice'].includes(kind);
    if (field === 'seller') return invoice ? 'Поставщик' : 'Исполнитель';
    return invoice ? 'Плательщик' : 'Заказчик';
  }

  function closeReview() {
    draftRequest++;
    if (!openReview) return;
    openReview.detail.remove();
    openReview.toggle.textContent = openReview.label;
    openReview.toggle.setAttribute('aria-expanded', 'false');
    openReview.toggle.setAttribute('aria-label', openReview.label + ': ' + openReview.item.name);
    openReview = null;
  }

  async function openPdf(item, status, trigger) {
    trigger.disabled = true;
    try {
      await call('original', { revision: view.revision, arrivalId: item.arrivalId });
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      trigger.disabled = false;
    }
  }

  async function saveReview(item, decision, extra = {}, status = reportAction, trigger) {
    if (pending || view?.running) {
      status.textContent = 'Дождитесь завершения разбора.';
      return;
    }
    if (!view?.signedIn) {
      status.textContent = 'Войдите в DataCore через «Настройки».';
      return;
    }
    const next = Array.from(reportItems.querySelectorAll('.intake-quick-confirm'));
    const nextId = next[next.indexOf(trigger) + 1]?.dataset.reviewId;
    pending = 'reviewdecision';
    update();
    status.textContent = 'Сохраняем…';
    try {
      const result = await call('reviewdecision', {
        revision: view.revision, arrivalId: item.arrivalId, version: item.version, decision, ...extra,
      });
      restoreReview = result.state === 'question' && openReview?.item.arrivalId === item.arrivalId ? item.arrivalId : '';
      closeReview();
      reportResultFor = item.arrivalId;
      reportAction.textContent = result.returnToManager ? 'Помечено для возврата менеджеру.'
        : decision === 'undo-return' ? 'Документ снова в «Проверить оформление».'
        : result.state === 'checked' ? 'Подтверждено. Документ проверен.'
        : 'Подтверждено. Остались замечания.';
      lastReportKey = '';
    } catch (error) {
      status.textContent = error.message;
      return;
    } finally {
      pending = '';
      update();
    }
    await refresh(true);
    if (nextId && trigger) {
      Array.from(reportItems.querySelectorAll('.intake-quick-confirm'))
        .find(node => node.dataset.reviewId === nextId)?.focus({ preventScroll: true });
    }
  }

  function reportTable(groups) {
    const table = el('table', 'intake-report-table');
    table.setAttribute('aria-label', 'Результаты проверки документов');
    const head = el('thead');
    const columns = el('tr');
    for (const title of ['Документ', 'Сверка', 'Действия']) {
      const th = el('th', '', title);
      th.scope = 'col';
      columns.append(th);
    }
    head.append(columns);
    table.append(head);

    for (const { title, items, label } of groups) {
      const group = el('tbody', 'intake-report-group');
      const groupTitle = el('tr', 'intake-report-group-title');
      const groupName = el('th', '', title + ' · ' + items.length);
      groupName.colSpan = 3;
      groupName.scope = 'rowgroup';
      groupTitle.append(groupName);
      group.append(groupTitle);
      table.append(group);
      const appendRows = (offset) => {
        for (const item of items.slice(offset, offset + 50)) {
          const row = el('tr', 'intake-report-row');
          const document = el('th', 'intake-report-doc', item.name);
          document.scope = 'row';
          const evidence = el('td', 'intake-report-evidence');
          const actions = el('td', 'intake-report-controls');
          const people = item.reviewParties || [];
          const issue = (item.issues || []).find(value => !people.some(person => value.field === person.field)) || item.issues?.[0];
          if (destination[item.kind]) document.append(el('p', 'intake-updated', kinds[item.kind]));
          if (people.length) {
            for (const person of people) {
              const role = partyLabel(item.kind, person.field);
              const short = el('div', 'intake-quick-party');
              short.append(el('strong', '', role + ' · ' + person.name),
                el('p', 'intake-updated', 'ИНН ' + person.inn + (person.page ? ' · стр. ' + person.page : '')));
              evidence.append(short);
            }
          }
          if (!people.length && issue) evidence.append(el('p', 'intake-report-issue', issue.message));
          else if (!people.length && destination[item.kind]) evidence.append(el('p', 'intake-updated', destination[item.kind]));

          if (item.arrivalId && item.version) {
            const toggle = button(label, () => loadDraft(item, row, toggle, label), 'ghost intake-review-toggle');
            toggle.dataset.reviewId = item.arrivalId;
            toggle.setAttribute('aria-label', label + ': ' + item.name);
            toggle.setAttribute('aria-expanded', 'false');
            if (people.length) {
              for (const person of people) {
                const role = partyLabel(item.kind, person.field);
                const confirm = button('Подтвердить', () => saveReview(item, 'confirm-party', person, reportAction, confirm), 'primary intake-quick-confirm');
                confirm.dataset.reviewId = item.arrivalId + person.field;
                confirm.setAttribute('aria-label', 'Подтвердить: ' + item.name + ' · ' + role);
                const edit = button('Исправить', () => loadDraft(item, row, toggle, label, person.field));
                edit.setAttribute('aria-label', 'Исправить: ' + item.name + ' · ' + role);
                actions.append(actionRow(confirm, edit));
                draftButtons.push(confirm, edit);
              }
              const original = button('PDF', () => openPdf(item, reportAction, original));
              original.setAttribute('aria-label', 'PDF: ' + item.name);
              actions.append(actionRow(original, toggle));
              draftButtons.push(original);
            } else {
              actions.append(actionRow(toggle));
            }
            draftButtons.push(toggle);
            if (/\.pdf$/i.test(item.name || '')) {
              const images = button('Рисунки…', () => imageReview.open(item));
              images.setAttribute('aria-label', 'Рисунки: ' + item.name);
              actions.append(actionRow(images));
              draftButtons.push(images);
            }
          }
          row.append(document, evidence, actions);
          group.insertBefore(row, moreRow);
        }
        moreRow.hidden = offset + 50 >= items.length;
      };
      const moreRow = el('tr', 'intake-report-more');
      const moreCell = el('td');
      moreCell.colSpan = 3;
      let offset = 0;
      moreCell.append(button('Показать ещё', () => { offset += 50; appendRows(offset); }));
      moreRow.append(moreCell);
      group.append(moreRow);
      appendRows(offset);
    }
    return table;
  }

  async function loadReport(force = false) {
    if (!visible || pane !== 'report' || !view) return;
    if (!view.settings.root || !view.signedIn) {
      reportRequest++;
      lastReportKey = '';
      reportTime.textContent = '';
      reportStatus.textContent = '';
      reportItems.replaceChildren(el('p', 'intake-updated', !view.settings.root ? 'Выберите папку, чтобы открыть её отчёт.' : 'Войдите в DataCore в настройках, чтобы открыть локальные черновики.'));
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
      const needsData = item => item.issues.some(issue => /отсутствует в справочнике|счёт выставлен нашей компанией|нужен оригинал PDF|привязать к договору|похожий номер|документ с этим номером|роль поставщика/iu.test(issue.message));
      const returned = exceptions.filter(item => item.returnToManager);
      const format = exceptions.filter(item => !item.returnToManager && item.issues.some(issue => issue.code === 'SOURCE_FORMAT'));
      const other = exceptions.filter(item => !item.returnToManager && !format.includes(item));
      const missing = other.filter(needsData);
      const compare = other.filter(item => !needsData(item));
      const incomplete = report.items.filter((item) => ['pending', 'extracting', 'proposing', 'sending'].includes(item.state));
      const checked = report.items.filter((item) => item.state === 'checked');
      const uploaded = report.items.filter((item) => item.state === 'uploaded');
      const existing = report.items.filter((item) => item.state === 'existing');
      draftButtons = [];
      const groups = [
        { title: 'Нужна сверка', items: compare, label: 'Сверить' },
        { title: 'Проверить оформление', items: format, label: 'Сверить оформление' },
        { title: 'Вернуть менеджеру', items: returned, label: 'Открыть' },
        { title: 'Нужны данные или решение', items: missing, label: 'Открыть' },
        { title: 'В работе', items: incomplete, label: 'Сверить' },
        { title: 'Проверено в Пульте', items: checked, label: 'Открыть' },
        { title: 'Отправлено на сайт', items: uploaded, label: 'Открыть' },
        { title: 'Уже на сайте', items: existing, label: 'Открыть' },
      ].filter(group => group.items.length);
      const retained = openReview && report.items.some(item => item.arrivalId === openReview.item.arrivalId
        && item.version === openReview.item.version && item.state === openReview.item.state);
      if (!retained) closeReview();
      reportItems.replaceChildren(groups.length ? reportTable(groups)
        : el('p', 'intake-updated', 'Результаты появятся после разбора документов.'));
      const toggles = Array.from(reportItems.querySelectorAll('.intake-review-toggle'));
      if (retained) {
        const toggle = toggles.find(node => node.dataset.reviewId === openReview.item.arrivalId);
        if (toggle) {
          toggle.closest('tr').after(openReview.detail);
          toggle.textContent = 'Скрыть';
          toggle.setAttribute('aria-label', 'Скрыть: ' + openReview.item.name);
          toggle.setAttribute('aria-expanded', 'true');
          openReview.toggle = toggle;
        } else closeReview();
      }
      update();
      if (restoreReview) {
        const button = toggles.find(node => node.dataset.reviewId === restoreReview);
        restoreReview = '';
        button?.click();
      }
    } catch (error) {
      if (reportRequest !== request) return;
      lastReportKey = '';
      reportStatus.textContent = error.message;
    }
  }

  async function loadDraft(item, row, toggle, label, editField) {
    if (pending || view?.running || !view?.signedIn) return;
    if (reportResultFor !== item.arrivalId) reportAction.textContent = '';
    if (openReview?.item.arrivalId === item.arrivalId && !editField) {
      closeReview();
      return;
    }
    closeReview();
    const request = ++draftRequest;
    const detail = el('tr', 'intake-report-detail');
    const cell = el('td');
    cell.colSpan = 3;
    const draftFeedback = feedback('intake-feedback');
    const draftContent = el('div', 'intake-draft-content');
    cell.append(draftFeedback, draftContent);
    detail.append(cell);
    row.after(detail);
    toggle.textContent = 'Скрыть';
    toggle.setAttribute('aria-label', 'Скрыть: ' + item.name);
    toggle.setAttribute('aria-expanded', 'true');
    openReview = { detail, toggle, label, item };
    draftFeedback.textContent = 'Загружаем…';
    try {
      const draft = await call('draft', { revision: view.revision, arrivalId: item.arrivalId });
      if (request !== draftRequest || pane !== 'report') return;
      draftFeedback.textContent = '';
      renderDraft(draft, draftContent, draftFeedback, editField);
    } catch (error) {
      if (request === draftRequest) draftFeedback.textContent = error.message;
    }
  }

  function renderDraft(draft, draftContent, draftFeedback, editField) {
    const raw = draft.raw;
    const pages = Array.isArray(draft.pages) ? draft.pages : [];
    const issues = (draft.issues || []).filter(issue => issue?.message);
    const issueMessages = [...new Set(issues.map(issue => issue.message))];
    const partiesToReview = new Set(issues.map(issue => issue.field).filter(key => ['seller', 'buyer'].includes(key)));
    const factsToReview = new Set(issues.map(issue => issue.field).filter(key => ['gross', 'number', 'date'].includes(key)));
    const sourceFormat = issues.some(issue => issue.code === 'SOURCE_FORMAT');
    const saveDecision = (decision, extra) => saveReview(draft, decision, extra, draftFeedback);
    const issueBox = el('div', 'intake-draft-issues');
    for (const message of issueMessages) issueBox.append(el('p', '', message));

    const reader = el('details', 'intake-source');
    const readerTitle = el('summary', '', 'Текст оригинала');
    const sourceText = el('pre');
    const pageChoice = el('select');
    const pageLabel = el('label', 'intake-page-select', 'Страница');
    for (let index = 0; index < pages.length; index++) {
      const option = el('option', '', String(index + 1));
      option.value = String(index + 1);
      pageChoice.append(option);
    }
    function showPage(number) {
      pageChoice.value = String(number);
      sourceText.textContent = pages[number - 1] || 'Текст на этой странице не прочитан.';
    }
    pageLabel.append(pageChoice);
    reader.append(readerTitle, pageLabel, sourceText);
    reader.hidden = !pages.length;
    if (pages.length) showPage(1);
    pageChoice.onchange = () => showPage(Number(pageChoice.value));

    const text = value => typeof value === 'string' && value.trim() ? value
      : typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU') : '';
    const normalized = value => value.normalize('NFKC').replace(/\u00ad/g, '-').replace(/\s+/gu, ' ').trim();
    const sourceCell = ({ proof, key, label }) => {
      const cell = el('td', 'intake-original');
      const page = Number.isInteger(proof?.page) && typeof pages[proof.page - 1] === 'string' ? proof.page : 0;
      const quote = typeof proof?.quote === 'string' ? normalized(proof.quote) : '';
      const columns = ['seller', 'buyer'].includes(key) && Array.isArray(draft.partyColumns) ? draft.partyColumns : [];
      const rowSource = Array.isArray(draft.printedRows) && draft.printedRows.find(row => row.page === page && row.quote === proof?.quote);
      const sources = page ? [pages[page - 1], ...columns.filter(column => column.page === page).map(column => column.quote),
        ...(rowSource ? [rowSource.quote] : []),
      ] : [];
      let excerpt = '';
      if (quote) {
        for (const source of sources) {
          if (typeof source !== 'string') continue;
          const content = normalized(source);
          const start = content.indexOf(quote);
          if (start < 0) continue;
          const line = source.split(/\r?\n/).find(value => normalized(value).includes(quote));
          excerpt = line && line.length <= 230 ? line.trim() : content.slice(start, start + quote.length);
          break;
        }
      }
      const manual = draft.manualParties?.[key];
      const inn = proof?.inn;
      const innPattern = typeof inn === 'string' && /^\d{10}(?:\d{2})?$/u.test(inn)
        ? new RegExp('(?<!\\d)' + inn + '(?!\\d)', 'u') : null;
      const innPage = !excerpt && innPattern ? pages.findIndex(value => innPattern.test(value)) + 1 : 0;
      const visibleText = excerpt.length > 260 ? excerpt.slice(0, 257) + '…' : excerpt;
      cell.append(el('p', excerpt ? 'intake-excerpt' : 'intake-updated', manual
        ? 'Подтверждено вручную'
        : visibleText || (innPage ? 'ИНН есть на странице ' + innPage + '. Проверьте, чьи это реквизиты.'
          : partiesToReview.has(key) ? 'Откройте PDF и найдите название и ИНН этой стороны.'
          : pages.length ? 'Строка PDF не найдена' : 'Текст PDF недоступен')));
      const sourcePage = innPage || page;
      if (sourcePage && !manual) {
        const open = button('Стр. ' + sourcePage, () => {
          showPage(sourcePage);
          reader.open = true;
          reader.scrollIntoView({ block: 'nearest' });
          readerTitle.focus({ preventScroll: true });
        }, 'intake-page-link');
        open.setAttribute('aria-label', label + ' · открыть страницу ' + sourcePage);
        cell.append(open);
      }
      return cell;
    };
    const partyText = party => [text(party?.name), party?.inn ? 'ИНН ' + text(party.inn) : ''].filter(Boolean).join('\n');
    const vatModes = { none: 'Без НДС', included: 'НДС включён', excluded: 'НДС сверх цены' };
    const vatText = raw?.vat ? [vatModes[raw.vat.mode], raw.vat.rate == null ? '' : text(raw.vat.rate) + '%',
      raw.vat.amount == null ? '' : text(raw.vat.amount) + ' ₽'].filter(Boolean).join(' · ') : '';
    const invoice = ['supplier_invoice', 'customer_invoice'].includes(draft.kind);
    const fields = raw && typeof raw === 'object' ? [
      { key: 'kind', label: 'Документ', value: kinds[draft.kind] || kinds[raw.kind], proof: raw.kindEvidence },
      { key: 'number', label: 'Номер', value: text(raw.number?.value), proof: raw.number },
      { key: 'date', label: 'Дата', value: text(raw.date?.value).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1'), proof: raw.date },
      { key: 'seller', label: invoice ? 'Поставщик' : 'Исполнитель', value: partyText(draft.manualParties?.seller || raw.seller), proof: raw.seller },
      { key: 'buyer', label: invoice ? 'Плательщик' : 'Заказчик', value: partyText(draft.manualParties?.buyer || raw.buyer), proof: raw.buyer },
      { key: 'gross', label: 'Итог', value: text(raw.gross?.value), proof: raw.gross },
      { key: 'currency', label: 'Валюта', value: raw.currency?.value === 'RUB' ? 'Рубли' : text(raw.currency?.value), proof: raw.currency },
      { key: 'vat', label: 'НДС', value: vatText, proof: raw.vat },
    ] : [];
    const lines = Array.isArray(raw?.lines) ? raw.lines.slice(0, 200).map((line, index) => ({
      key: 'line-' + (index + 1), label: 'Позиция ' + (index + 1), proof: line,
      value: [text(line?.title), [text(line?.qty), text(line?.unit)].filter(Boolean).join(' '),
        line?.unitPrice == null ? '' : 'Цена ' + text(line.unitPrice),
        line?.amount == null ? '' : 'Сумма ' + text(line.amount)].filter(Boolean).join('\n'),
    })) : [];
    const flagged = new Set(issues.flatMap(({ message, field }) => {
      if (field) return [field];
      const line = message.match(/строк[аиуе]\s+(\d+)/iu);
      if (line) return ['line-' + line[1]];
      if (/сумм[ауые] всех строк|состав документа/iu.test(message)) return ['gross', 'lines'];
      if (/поставщик|исполнител|продавец/iu.test(message)) return ['seller'];
      if (/покупател|заказчик|плательщик|контрагент/iu.test(message)) return ['buyer'];
      const keys = [['kind', /тип документ/iu], ['number', /номер документ/iu], ['date', /«дат[аыу]»/iu],
        ['gross', /итог|сумм[ауые] к оплате/iu], ['currency', /валют/iu], ['vat', /НДС/iu]];
      return keys.filter(([, pattern]) => pattern.test(message)).map(([key]) => key);
    }));

    function comparison(rows, label) {
      const table = el('table', 'intake-review-table');
      table.setAttribute('aria-label', label);
      const head = el('thead');
      const titles = el('tr');
      for (const title of ['Поле', 'Прочитал Пульт', 'В оригинале PDF']) {
        const cell = el('th', '', title); cell.scope = 'col'; titles.append(cell);
      }
      head.append(titles);
      const body = el('tbody');
      for (const row of rows) {
        const item = el('tr', flagged.has(row.key) ? 'intake-review-flagged' : '');
        const heading = el('th', '', row.label);
        heading.scope = 'row';
        const read = el('td', 'intake-read-value', row.value || 'Не прочитано');
        if (partiesToReview.has(row.key) && !draft.returnToManager) {
          const name = field('Название по PDF', { value: row.proof?.name || '', maxLength: 300 });
          const inn = field('ИНН по PDF', { value: row.proof?.inn || '', inputMode: 'numeric', maxLength: 24 });
          const confirm = values => saveDecision('confirm-party', { field: row.key, ...values });
          const form = el('form', 'intake-party-edit');
          form.hidden = editField !== row.key;
          const save = button('Сохранить исправление', () => {}, 'primary');
          save.type = 'submit';
          save.onclick = null;
          name.input.required = true;
          inn.input.required = true;
          inn.input.pattern = '[0-9 ]{10,24}';
          form.onsubmit = event => { event.preventDefault(); confirm({ name: name.input.value, inn: inn.input.value }); };
          const cancel = button('Отмена', () => { form.hidden = true; controls.hidden = false; edit.focus(); });
          form.append(name.label, inn.label, actionRow(save, cancel));
          const edit = button(row.value ? 'Исправить' : 'Ввести из PDF', () => {
            controls.hidden = true;
            form.hidden = false;
            name.input.focus();
          });
          const controls = actionRow(edit);
          if (row.proof?.name && row.proof?.inn) {
            controls.prepend(button('Подтвердить', () => confirm({ name: row.proof.name, inn: row.proof.inn }), 'primary'));
          }
          controls.hidden = !form.hidden;
          read.append(controls, form);
          if (!form.hidden) queueMicrotask(() => name.input.focus());
        }
        if (factsToReview.has(row.key) && !draft.returnToManager) {
          const fact = field(row.label + ' по PDF', { value: row.value || '', maxLength: 100, required: true });
          if (row.key === 'gross') fact.input.inputMode = 'decimal';
          const form = el('form', 'intake-party-edit');
          const save = el('button', 'primary', 'Сохранить');
          save.type = 'submit';
          form.append(fact.label, actionRow(save));
          form.onsubmit = event => {
            event.preventDefault();
            saveDecision('confirm-fact', { field: row.key, value: fact.input.value });
          };
          read.replaceChildren(form);
        }
        item.append(heading, read, sourceCell(row));
        body.append(item);
      }
      table.append(head, body);
      return table;
    }
    function folded(title, child) {
      const section = el('details', 'intake-review-details');
      section.append(el('summary', '', title), child);
      return section;
    }

    const content = [];
    if (draft.vision?.pages?.length && draft.vision.state !== 'unavailable') {
      const detail = draft.vision.fields?.length ? ' · подтверждено полей: ' + draft.vision.fields.length : '';
      content.push(el('p', 'intake-updated', 'ИИ посмотрел страницы PDF ' + draft.vision.pages.join(', ') + detail));
    }
    if (draft.layoutFields?.length) content.push(el('p', 'intake-updated', 'Повторно проверено по знакомому макету: ' + draft.layoutFields.length));
    if (issueMessages.length) content.push(issueBox);
    if (partiesToReview.size && !draft.returnToManager) {
      content.push(el('p', 'intake-updated', 'Откройте PDF. Если название и ИНН совпадают, нажмите «Подтвердить». При расхождении нажмите «Исправить».'));
    }
    if (sourceFormat) {
      const decision = draft.returnToManager ? 'undo-return' : 'mark-return';
      const title = draft.returnToManager ? 'Вернуть на сверку' : 'Пометить для возврата менеджеру';
      content.push(actionRow(button(title, () => saveDecision(decision), 'primary')));
    }
    if (/\.pdf$/iu.test(draft.name || '')) {
      const open = button('Открыть оригинал PDF', () => openPdf(draft, draftFeedback, open));
      content.push(actionRow(open));
    }
    const attention = [...fields, ...lines].filter(row => flagged.has(row.key));
    if (attention.length) {
      content.push(comparison(attention, 'Поля для сверки'));
      const otherFields = fields.filter(row => !flagged.has(row.key));
      if (otherFields.length) content.push(folded('Остальные реквизиты', comparison(otherFields, 'Остальные реквизиты')));
    } else if (fields.length) content.push(comparison(fields, 'Реквизиты'));
    else content.push(el('p', 'intake-updated', 'Пульт не прочитал реквизиты документа.'));
    const otherLines = lines.filter(row => !flagged.has(row.key));
    if (otherLines.length) {
      const section = folded('Позиции · ' + otherLines.length, comparison(otherLines, 'Позиции документа'));
      section.open = flagged.has('lines');
      content.push(section);
    }
    const actions = [...new Set(issues.map(issue => issue.action).filter(Boolean))];
    const doubts = (Array.isArray(raw?.doubts) ? raw.doubts : []).filter(value => typeof value === 'string' && value.trim()).slice(0, 30);
    for (const [title, items] of [['Что делать', actions], ['Замечания модели', doubts]]) {
      if (!items.length) continue;
      const list = el('ul', 'intake-model-doubts');
      list.append(...items.map(value => el('li', '', value.slice(0, 500))));
      content.push(folded(title, list));
    }
    if (pages.length) content.push(reader);
    draftContent.replaceChildren(...content);
  }

  function refresh(forceReport = false) {
    if (!visible) return Promise.resolve();
    if (statusRequest) { refreshAgain = true; return statusRequest; }
    statusRequest = call('status').then((snapshot) => {
      view = snapshot;
      update();
      if (!pane) showPane(snapshot.settings.apiBase && snapshot.signedIn ? 'report' : 'settings');
      else return loadReport(forceReport);
    }).catch((error) => { mainFeedback.textContent = error.message; }).finally(() => {
      statusRequest = null;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    });
    return statusRequest;
  }

  async function delivery(action) {
    if (pending || !view?.signedIn) return;
    const id = confirmationId;
    resetConfirmation();
    pending = action; update();
    showPane('report');
    mainFeedback.textContent = action === 'prepare' ? 'Проверяем версии и справочники…' : 'Отправляем и сверяем квитанции…';
    try {
      const result = await call(action, { revision: view.revision, confirmationId: id });
      const problems = (result.problems || []).map(item => item.name + ' — ' + item.message);
      if (action === 'prepare' && result.items.length) {
        confirmationId = result.id;
        const heading = el('h3', '', 'Готово к отправке · ' + result.items.length);
        heading.tabIndex = -1;
        const list = el('ul', 'intake-report-list');
        for (const item of result.items) list.append(el('li', '', [item.name, destination[item.kind], item.reference && 'договор № ' + item.reference.number, 'версия ' + item.version].filter(Boolean).join(' · ')));
        const accept = button('Подтвердить отправку', () => delivery('send'), 'primary act-go');
        const cancel = button('Отмена', () => { resetConfirmation(); prepare.focus(); });
        confirmation.append(heading, el('p', '', 'Контур ' + result.target), list, actionRow(accept, cancel));
        confirmation.hidden = false; heading.focus();
      }
      const summary = action === 'send' ? 'Отправлено на сайт: ' + result.uploaded : result.items.length ? 'Проверьте список перед отправкой.' : 'Готовых документов нет.';
      mainFeedback.textContent = [summary, ...problems].join(' ');
    } catch (error) { mainFeedback.textContent = error.message; }
    finally { pending = ''; await refresh(true); update(); }
  }

  async function perform(action, body, message, success = '') {
    if (pending) return;
    pending = action;
    message.textContent = action === 'modelprobe' ? 'Проверяем ответ модели…' : '';
    message.classList.remove('intake-model-ready');
    update();
    try {
      const result = await call(action, { ...body, revision: view?.revision });
      message.textContent = success;
      if (action === 'modelprobe' && result.ready) message.classList.add('intake-model-ready');
      if (action === 'inbox') message.textContent = result.focused ? 'Входящие открыты. Положите туда PDF.' : 'Проверьте Проводник на панели задач. Путь к входящим виден в настройках.';
      if (result.cancelled) message.textContent = 'Папка осталась прежней.';
      if (action === 'analyze') showPane('report');
    } catch (error) {
      message.textContent = error.message;
    } finally {
      pending = '';
      await refresh(['folder', 'detach', 'inbox'].includes(action));
      update();
    }
  }

  update();
  return {
    mount(center, aside) {
      if (center.firstChild !== main) center.replaceChildren(main);
      if (aside.firstChild !== side) aside.replaceChildren(side);
      if (!visible) {
        visible = true;
        side.closest('.layout')?.classList.toggle('intake-review-open', pane === 'draft');
        refresh(true);
      }
    },
    hide() {
      visible = false;
      side.closest('.layout')?.classList.remove('intake-review-open');
      clearInterval(activityTimer); activityTimer = null;
      password.input.value = '';
    },
    refresh,
  };
}
