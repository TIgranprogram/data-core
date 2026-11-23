// C239: предпросмотр не пишет на сайт; отправка — только после явного подтверждения.
export function createDocumentImages({ el, button, actionRow, call, getView, canRun, setBusy, refresh }) {
  const element = el('section', 'card intake-card');
  const status = el('p', 'intake-feedback');
  let plan = null;
  let arrivalId = '';
  const reset = () => { plan = null; arrivalId = ''; element.hidden = true; element.replaceChildren(); };
  reset();

  async function send(trigger) {
    if (!plan || !canRun()) { status.textContent = 'Дождитесь завершения текущего действия и проверьте вход.'; return; }
    const confirmationId = plan.confirmationId;
    trigger.disabled = true;
    setBusy('imagessend');
    status.textContent = 'Проверяем рисунки и привязки на сайте…';
    try {
      const result = await call('imagessend', { revision: getView().revision, arrivalId, confirmationId });
      plan = null;
      status.textContent = `Рисунки проверены у ${result.attached} позиций. Новых привязок: ${result.added || 0}.`;
    } catch (error) {
      plan = null;
      status.textContent = error.message;
    } finally { setBusy(''); await refresh(true); }
  }

  async function open(item, contractId) {
    if (!canRun()) return;
    reset();
    arrivalId = item.arrivalId;
    const heading = el('h3', '', 'Рисунки из документа');
    heading.tabIndex = -1;
    element.append(heading, status);
    element.hidden = false;
    status.textContent = 'Проверяем оригинал и исходные позиции договора…';
    setBusy('imagesprepare');
    try {
      const result = await call('imagesprepare', { revision: getView().revision, arrivalId, contractId });
      if (result.selectionRequired) {
        const label = el('label', '', 'Номер договора');
        const input = el('input'); input.type = 'search'; input.placeholder = 'Например, 18/11/44';
        label.append(input);
        const choices = el('div');
        const search = button('Найти договор', async () => {
          if (!canRun()) return;
          setBusy('imagescontracts'); choices.replaceChildren();
          try {
            const found = await call('imagescontracts', { revision: getView().revision, arrivalId, search: input.value });
            for (const candidate of found.items) choices.append(button(candidate.label, () => open(item, candidate.id)));
            status.textContent = found.items.length ? 'Выберите договор. Проверим, что в нём есть этот оригинал PDF.' : 'Договоры не найдены.';
            if (found.truncated) status.textContent += ' Уточните номер: показаны первые 20.';
          } catch (error) { status.textContent = error.message; }
          finally { setBusy(''); }
        });
        element.append(label, actionRow(search, button('Закрыть', reset)), choices);
        status.textContent = 'Выберите договор, к которому прикреплён исходный документ.';
        input.focus();
        return;
      }
      plan = result;
      const contract = result.contractNo ? `Договор № ${result.contractNo}` : 'Договор без номера';
      element.append(el('p', '', `${contract} · Позиций: ${result.items.length} · Рисунков: ${result.uniqueImages}`),
        el('p', 'intake-updated', 'Сайт: ' + result.target));
      for (const warning of result.warnings || []) element.append(el('p', 'intake-updated', warning));
      const table = el('table', 'intake-report-table');
      table.setAttribute('aria-label', 'Рисунки и исходные позиции договора');
      const head = el('tr');
      for (const label of ['Рисунок', 'Исходная позиция', 'На сайте']) head.append(el('th', '', label));
      const thead = el('thead'); thead.append(head); table.append(thead);
      const body = el('tbody');
      for (const item of result.items) {
        const row = el('tr');
        const picture = el('td');
        if (typeof item.preview !== 'string' || item.preview.length > 4_194_350
          || !/^data:image\/(?:png|jpeg);base64,[A-Za-z\d+/]+={0,2}$/.test(item.preview)) throw new Error('Предпросмотр рисунка не подтверждён.');
        const image = el('img');
        image.src = item.preview; image.alt = item.sku || 'Рисунок исходной позиции';
        image.width = Math.min(120, Math.max(1, item.width));
        image.height = Math.max(1, Math.round(image.width * item.height / item.width));
        picture.append(image, el('p', 'intake-updated', `${item.width} × ${item.height} · стр. ${item.page}`));
        row.append(picture, el('td', '', item.title), el('td', '', item.alreadyAttached ? 'Уже прикреплён' : 'Прикрепить'));
        body.append(row);
      }
      table.append(body); element.append(table);
      const accept = button('Загрузить рисунки', () => send(accept), 'primary');
      accept.disabled = result.alreadyAttached === result.items.length;
      element.append(actionRow(accept, button('Закрыть', reset)));
      status.textContent = accept.disabled ? 'Все рисунки уже прикреплены. Повторная загрузка не нужна.' : 'Проверьте рисунки и позиции перед отправкой. Каталог изделий не изменяется.';
      heading.focus();
    } catch (error) { plan = null; status.textContent = error.message; }
    finally { setBusy(''); }
  }
  return { element, open, reset };
}
