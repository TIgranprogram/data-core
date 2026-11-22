import { h } from '../../core/dom.js';
import { attachCombo, buildForm, button, guide, section, select, stack, textInput } from '../../ui/kit/index.js';
import { offerProductSearch } from './funnel/items-step.js';
import { money } from '../../core/format.js';

export const blocks = { table: 'Таблица и итог', info: 'Доставка и НДС', terms: 'Условия', notes: 'Примечание' };
export const group = (title, ...body) => h('section', { class: 'bk-panel' },
  h('header', { class: 'bk-panel-h' }, h('h3', { class: 'bk-toc-h' }, title)), ...body);
const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);

export function editorControls({ draft, saved, view, backgrounds, parties, changed, selectView, paintNav, removeRow, newRows }) {
  const rowIndex = typeof view === 'number' ? view : -1;
  const target = rowIndex < 0 ? draft : draft.items[rowIndex];
  function input(key, label, opts = {}) {
    const { area, type = 'text', min, max, length, step, locked, after } = opts;
    const control = area
      ? buildForm([{ key, label, type: 'textarea', rows: 4, max: length, wide: true }], { [key]: target[key] })
      : textInput({ label, type, max: length, value: target[key], disabled: locked });
    const el = control.input || control.el.querySelector('textarea');
    for (const [attr, v] of Object.entries({ min, max, step })) if (v !== undefined) el.setAttribute(attr, v);
    el.addEventListener('input', () => {
      target[key] = type === 'number' ? (el.value === '' ? null : el.valueAsNumber) : el.value;
      after?.(target[key]);
      changed();
    });
    return control.el;
  }
  function choice(key, label, options, after) {
    const el = select({ label, options, value: target[key] ?? '', onChange: (v) => {
      target[key] = v || null; after?.(); changed();
    } });
    return field(label, el);
  }
  function position(key) {
    const make = (prop, label, min, max) => {
      const control = textInput({ type: 'number', label, placeholder: '0', value: draft.layout[key]?.[prop] });
      const el = control.input;
      Object.assign(el, { min, max, step: 1 });
      el.addEventListener('input', () => {
        const values = { ...draft.layout[key] };
        if (el.value === '') delete values[prop];
        else values[prop] = el.valueAsNumber;
        if (Object.keys(values).length) draft.layout[key] = values;
        else delete draft.layout[key];
        changed();
      });
      return control.el;
    };
    return section({ title: 'Положение на листе', plain: true,
      body: [make('xMm', 'Сдвиг вправо, мм', -10, 10), make('gapMm', 'Отступ сверху, мм', 0, 40)] });
  }
  if (view === 'document') {
    const customer = input('customer', 'Заказчик', { length: 300, after: () => { draft.counterpartyId = null; } });
    const name = customer.querySelector('input');
    attachCombo(name, { options: () => parties, onPick: (o) => {
      name.value = draft.customer = o.label; draft.counterpartyId = o.value || null; changed();
    } });
    const background = (page) => {
      const key = page === 1 ? 'bg1Id' : 'bg2Id';
      const own = backgrounds.filter((b) => b.companyId === saved.companyId && Number(b.page) === page);
      const options = [['', 'По умолчанию'], ...(page === 2 ? [['none', 'Белая страница']] : []), ...own.map((b) => [b.id, b.name])];
      if (saved[key] && !options.some(([id]) => id === saved[key])) options.push([saved[key], 'Прежний бланк КП']);
      return choice(key, page === 1 ? 'Бланк первой страницы' : 'Бланк следующих страниц', options);
    };
    return group('Документ', customer, input('objectName', 'Объект', { length: 500 }), background(1), background(2), position('header'));
  }
  if (rowIndex >= 0) {
    const source = !!(target.sourceLine || target.sourceRowKey);
    const picker = newRows.has(target) ? offerProductSearch((p) => {
      Object.assign(target, { productId: p.id, productName: p.name, productSku: p.sku || null,
        unit: p.unit || 'шт', unitPrice: p.price ?? null, photoUrl: p.photo?.thumb || p.photo?.url || null,
        description: p.description || '', color: p.color || p.colors?.[0] || null, size: p.size || p.sizes?.[0] || null });
      changed(); selectView(rowIndex);
    }) : null;
    const page = guide.toggle({ label: 'Начать с новой страницы', checked: !!target.pageBreakBefore, onChange: (checked) => {
      target.pageBreakBefore = checked; changed();
    } });
    function moveRow(delta) {
      const next = rowIndex + delta;
      [draft.items[rowIndex], draft.items[next]] = [draft.items[next], draft.items[rowIndex]];
      changed(); selectView(next);
    }
    return group('Строка ' + (rowIndex + 1),
      h('div', { class: 'bk-ed-row' },
        button({ label: 'Строку выше', disabled: rowIndex === 0, size: 'S', onClick: () => moveRow(-1) }),
        button({ label: 'Строку ниже', disabled: rowIndex === draft.items.length - 1, size: 'S', onClick: () => moveRow(1) })),
      input('productName', 'Наименование', { length: 300, locked: source, after: paintNav }),
      picker,
      choice('lineKind', 'Вид строки', [['product', 'Изделие'], ['delivery', 'Доставка']]),
      input('description', 'Описание', { area: true, length: 1000 }),
      input('quantity', 'Количество', { type: 'number', min: 0.001, step: 'any', locked: source }),
      input('unit', 'Единица измерения', { length: 20, locked: source }),
      input('unitPrice', 'Цена за единицу, ₽', { type: 'number', min: 0, step: 'any', locked: source }),
      input('photoMm', 'Размер фотографии, мм', { type: 'number', min: 8, max: 42, step: 1 }),
      input('rowMm', 'Минимальная высота, мм', { type: 'number', min: 7, max: 65, step: 1 }),
      page, source ? null : button({ label: 'Удалить позицию', kind: 'danger', size: 'S', onClick: () => removeRow(target) }));
  }
  const order = draft.layout.blocks;
  const at = order.indexOf(view);
  const move = (delta) => {
    [order[at], order[at + delta]] = [order[at + delta], order[at]];
    changed(); selectView(view);
  };
  const arrows = h('div', { class: 'bk-ed-row' },
    button({ label: 'Выше', disabled: at < 1, size: 'S', onClick: () => move(-1) }),
    button({ label: 'Ниже', disabled: at === order.length - 1, size: 'S', onClick: () => move(1) }));
  let content;
  if (view === 'table') {
    const amount = textInput({ type: 'number', label: 'Наценка на изделия, %', placeholder: '0' });
    const markup = amount.input;
    Object.assign(markup, { min: -50, max: 200, step: 'any' });
    const note = h('span', { class: 'hint', role: 'status' }, 'Доставка и исходные цены юридического документа сохраняются.');
    const apply = () => {
      if (!markup.value || !markup.reportValidity()) { markup.focus(); return; }
      const pct = markup.valueAsNumber;
      if (pct === 0) { markup.value = ''; note.textContent = 'Цены сохранены без изменений.'; return; }
      const rows = draft.items.filter((r) => r.lineKind === 'product' && !r.sourceLine && r.unitPrice != null);
      if (!rows.length) { note.textContent = 'Нет изделий с редактируемой ценой.'; return; }
      for (const r of rows) r.unitPrice = Math.round((r.unitPrice * (100 + pct) / 100 + Number.EPSILON) * 100) / 100;
      markup.value = ''; note.textContent = 'Обновлены цены изделий: ' + rows.length; changed();
    };
    const width = textInput({ type: 'number', label: 'Ширина таблицы, мм', placeholder: '181', value: draft.layout.tableWidthMm });
    Object.assign(width.input, { min: 160, max: 181, step: 1 });
    width.input.addEventListener('input', () => {
      if (width.input.value === '') delete draft.layout.tableWidthMm;
      else draft.layout.tableWidthMm = width.input.valueAsNumber;
      changed();
    });
    content = stack(width.el, amount.el, button({ label: 'Применить наценку', size: 'S', onClick: apply }), note);
  } else if (view === 'info') {
    content = stack(choice('delivery', 'Доставка до объекта', [['', 'Не указывать'], ['included', 'Входит в стоимость'], ['excluded', 'Оплачивается отдельно']]),
      choice('vatMode', 'НДС', [['', 'По фирме'], ['with', 'С НДС'], ['without', 'Без НДС']]),
      input('vatRate', 'Ставка НДС, %', { type: 'number', min: 0, max: 30, step: 'any' }),
      input('validUntil', 'Предложение действует до', { type: 'date' }));
  } else if (view === 'terms') {
    content = stack(input('terms', 'Текст условий', { area: true, length: 3000 }),
      input('prepaymentPercent', 'Предоплата, %', { type: 'number', min: 0, max: 100, step: 'any' }),
      input('productionDays', 'Изготовление, дней', { type: 'number', min: 0, step: 1 }),
      input('deliveryDays', 'Доставка, дней', { type: 'number', min: 0, step: 1 }));
  } else {
    content = input('notes', 'Текст примечания', { area: true, length: 2000 });
  }
  return group(blocks[view], arrows, content, position(view));
}

export const rowTotal = (row) => money(row.sourceLine?.lineAmount ?? Math.round((row.unitPrice || 0) * row.quantity * 100) / 100);
