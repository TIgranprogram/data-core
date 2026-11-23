/* Дополнительные экраны роли: отдельная настройка представления, не API-права. */
(function () {
  function mount(role, { el, checkGrid }) {
    const label = el('label', '', 'Дополнительные экраны склада');
    const mode = el('select'); mode.setAttribute('aria-label', 'Дополнительные экраны склада');
    mode.append(new Option('По умолчанию', 'inherit'), new Option('Выбрать экраны', 'custom'));
    mode.value = Object.hasOwn(role, 'stockViews') ? 'custom' : 'inherit'; label.append(mode);
    const views = checkGrid([{ id: 'pipe', label: 'Труборез' }, { id: 'sheet', label: 'Лазер лист' }], new Set(Array.isArray(role.stockViews) ? role.stockViews : []));
    const sync = () => {
      views.grid.hidden = mode.value !== 'custom';
      views.grid.querySelectorAll('input').forEach(input => { input.disabled = mode.value !== 'custom'; });
    };
    mode.addEventListener('change', sync); sync();
    return { mode, box: views.grid, nodes: [label,
      el('p', 'muted small', 'По умолчанию директор видит оба экрана; остальные роли — без дополнительных экранов. Свой рабочий экран сохраняется. При выборе экранов пустой список отключает дополнительные экраны.'),
      views.grid, el('p', 'muted small', 'Дополнительные экраны открываются для просмотра при доступном разделе «Остатки». Это не настройка прав на складские операции.')] };
  }
  function read(fields, { isNew, checkedOf }) {
    if (!fields) return {};
    if (fields.mode.value === 'custom') return { stockViews: checkedOf(fields.box) };
    return isNew ? {} : { resetStockViews: true };
  }
  window.DataCoreRoleStockViews = { mount, read };
})();
