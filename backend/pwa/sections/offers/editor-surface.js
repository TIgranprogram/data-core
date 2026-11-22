import { h } from '../../core/dom.js';
import { button } from '../../ui/kit/index.js';

const titles = {
  date: 'Дата КП', customer: 'Заказчик', objectName: 'Объект',
  productName: 'Наименование', description: 'Описание', quantity: 'Количество',
  unit: 'Единица измерения', unitPrice: 'Цена за единицу', photo: 'Фото',
  table: 'Таблица', row: 'Строка', info: 'Доставка и НДС',
  terms: 'Условия', notes: 'Примечание',
};
const isText = (k) => k.startsWith('text:');
const block = (k) => ['table', 'info', 'terms', 'notes'].includes(k) || isText(k);
const label = ({ key, row }) =>
  (titles[key] || 'Текст') + (Number.isInteger(row) ? ' · позиция ' + (row + 1) : '');
const idOf = ({ key, row }) => key + '/' + (row ?? '');
const percent = (v, max) => (v / max * 100) + '%';
const rect = (node, b, size) => {
  node.style.setProperty('--sheet-x', percent(b.x, size.width));
  node.style.setProperty('--sheet-y', percent(b.y, size.height));
  node.style.setProperty('--sheet-w', percent(b.w, size.width));
  node.style.setProperty('--sheet-h', percent(b.h, size.height));
};

export async function offerGeometry(headers) {
  const raw = headers.get('x-offer-geometry');
  if (!raw) return null;
  const encoded = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const json = new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(json).json();
}

export function offerSurface(actions) {
  let layer, size, regions = [], selected, field, adornments;
  const lookup = (id) => regions.find((area) => idOf(area) === id);
  const select = (area) => {
    selected = idOf(area);
    paintSelection();
    actions.select(area);
  };
  function paintSelection() {
    if (!layer) return;
    for (const node of layer.querySelectorAll('.offer-hit')) {
      node.toggleAttribute('data-active', node.dataset.area === selected);
    }
    adornments?.remove();
    adornments = h('div');
    layer.append(adornments);
    const area = lookup(selected);
    if (!area || actions.busy()) return;
    const parentRow = Number.isInteger(area.row) && regions.find((a) => a.key === 'row' && a.row === area.row);
    if (parentRow) grip(parentRow, 'move', 'Перетащить строку', '⋮⋮');
    if (block(area.key)) grip(area, 'move', 'Перетащить ' + label(area).toLowerCase(), '⋮⋮');
    if (area.key === 'table') grip(area, 'resize', 'Изменить ширину таблицы', '↔');
    if (area.key === 'photo') grip(area, 'resize', 'Изменить размер фото', '↘');
    if (area.key === 'row') grip(area, 'resize', 'Изменить высоту строки', '↕');
  }
  function grip(area, mode, title, icon) {
    const control = button({ label: title, cls: 'offer-handle', kind: 'ghost', size: 'S', title });
    control.textContent = icon;
    control.dataset.mode = mode;
    control.setAttribute('aria-label', title);
    control.addEventListener('pointerdown', (e) => drag(e, area, mode));
    const box = h('div', { class: 'offer-handle-box', dataset: { target: area.key } }, control);
    rect(box, area, size);
    adornments.append(box);
  }
  function drag(event, area, mode) {
    if (event.button !== 0 || field || actions.busy()) return;
    event.preventDefault();
    const control = event.currentTarget;
    control.setPointerCapture(event.pointerId);
    const from = { x: event.clientX, y: event.clientY };
    const client = layer.getBoundingClientRect();
    const sx = size.width / client.width, sy = size.height / client.height;
    const ghost = h('span', { class: 'offer-ghost' });
    layer.append(ghost);
    const offset = (e) => ({ dx: (e.clientX - from.x) * sx, dy: (e.clientY - from.y) * sy });
    const move = (e) => {
      const { dx, dy } = offset(e);
      const scaled = area.key === 'photo' ? Math.max(-area.w + 1, dx + dy > 0 ? Math.max(dx, dy) : Math.min(dx, dy)) : 0;
      const next = mode === 'move' ? { ...area, x: area.x + dx, y: area.y + dy }
        : { ...area, w: Math.max(1, area.w + (area.key === 'table' ? dx : scaled)),
          h: Math.max(1, area.h + (area.key === 'row' ? dy : scaled)) };
      rect(ghost, next, size);
    };
    const finish = (e) => {
      ghost.remove();
      control.removeEventListener('pointermove', move);
      control.removeEventListener('pointerup', finish);
      control.removeEventListener('pointercancel', finish);
      control.removeEventListener('lostpointercapture', finish);
      if (e.type !== 'pointerup' || !layer.contains(control)) return;
      const delta = offset(e);
      if (Math.hypot(delta.dx, delta.dy) < 2) return;
      const y = (e.clientY - client.top) * sy;
      const targets = regions.filter((a) => (area.key === 'row' ? a.key === 'row' : block(a.key)) && idOf(a) !== idOf(area));
      let target = targets.find((a) => y >= a.y && y <= a.y + a.h);
      if (!target && area.key === 'row' && (y < area.y || y > area.y + area.h)) {
        target = targets.reduce((closest, a) => !closest || Math.abs(a.y + a.h / 2 - y) < Math.abs(closest.y + closest.h / 2 - y) ? a : closest, null);
      }
      actions.drag({ area, mode, ...delta, target, below: !!target && y > target.y + target.h / 2 });
    };
    rect(ghost, area, size);
    control.addEventListener('pointermove', move);
    control.addEventListener('pointerup', finish);
    control.addEventListener('pointercancel', finish);
    control.addEventListener('lostpointercapture', finish);
  }
  function edit(area, config = actions.field(area)) {
    if (!config || !layer || field || actions.busy()) return;
    const type = config.type;
    const input = h(type === 'area' ? 'textarea' : 'input', {
      ...(type === 'area' ? { rows: 3 } : { type: type === 'date' ? 'date' : 'text', inputmode: type === 'number' ? 'decimal' : null }),
      'aria-label': config.label || label(area), value: config.value ?? '', maxlength: config.max,
      placeholder: config.placeholder, 'data-offer-input': '',
    });
    const editor = h('form', { class: 'offer-inline' }, input,
      button({ label: 'Применить', type: 'submit', kind: 'primary', size: 'S' }),
      config.alternative ? button({ label: config.alternative.label, size: 'S', onClick: () => {
        finish(false);
        config.alternative.run();
      } }) : null,
      button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: () => finish(false) }));
    const w = Math.min(size.width - 30, Math.max(area.w, type === 'area' ? 260 : 174));
    rect(editor, { x: Math.max(12, Math.min(area.x, size.width - w - 12)),
      y: Math.max(0, Math.min(area.y, size.height - (type === 'area' ? 145 : 85))), w, h: 0 }, size);
    function finish(commit) {
      if (commit && config.validate && !config.validate(input.value)) {
        input.setCustomValidity('Проверьте значение');
        input.reportValidity();
        return;
      }
      field = null;
      editor.remove();
      actions.editState();
      if (commit) config.write(input.value);
      layer.querySelector('[data-active]')?.focus({ preventScroll: true });
    }
    input.addEventListener('input', () => input.setCustomValidity(''));
    editor.addEventListener('submit', (e) => { e.preventDefault(); finish(true); });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      if (e.key === 'Enter' && type === 'area' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    field = editor;
    layer.append(editor);
    actions.editState();
    input.focus({ preventScroll: true });
    if (type === 'date') {
      try { input.showPicker?.(); } catch { /* календарь доступен штатной кнопкой поля */ }
    } else if (type !== 'area') input.select();
  }
  function mount(node, pageSize, nextRegions) {
    layer = node; size = pageSize; regions = nextRegions || [];
    for (const old of layer.querySelectorAll('.offer-hit, .offer-ghost')) old.remove();
    for (const area of regions) {
      if (!titles[area.key] && !isText(area.key)) continue;
      const editable = !!actions.field(area);
      const title = label(area);
      const control = button({ label: title, cls: 'offer-hit', kind: 'ghost', size: 'S',
        title: editable ? 'Двойной щелчок · ' + title : title,
        onClick: () => { if (!field && !actions.busy()) select(area); },
      });
      control.textContent = '';
      control.setAttribute('aria-label', title);
      Object.assign(control.dataset, { area: idOf(area), kind: area.key.split(':')[0], editable: editable ? '1' : '0' });
      control.addEventListener('dblclick', () => edit(area));
      control.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && editable) { e.preventDefault(); select(area); edit(area); }
        if (e.key === 'Delete' && !actions.busy()) { e.preventDefault(); actions.remove(area); }
      });
      rect(control, area, size);
      layer.append(control);
    }
    paintSelection();
  }
  return {
    mount, refresh: paintSelection, get editing() { return !!field; },
    get selection() { return lookup(selected); },
    insert(config, fallback) {
      if (!layer) return;
      const anchor = lookup(selected) || regions.find((area) => area.key === fallback);
      edit({ key: 'text:new', x: anchor?.x ?? 40, y: anchor?.y ?? 110, w: 310, h: 40 }, config);
    },
  };
}
