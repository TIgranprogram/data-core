import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { button, section, fieldRow, textInput, toolbar, select, enhanceSelect, busyBlock, failBlock } from '../ui/kit/index.js';
import { workerCreateBody, workerCountBody, workerInputQuantity, workerPipeMetres, workerPipeTransfer, workerUnit, workerMaterialId } from './stock-worker-model.js';

/** Компактное создание в явной зоне. Успешный create не повторяется при ошибке count. */
export function workerCreate({ kind, getZone, host, changed, counterpart = null }) {
  let generation = 0, node = null, destroyed = false, quickInFlight = 0;
  const drafts = new Map();
  const blank = () => ({ value: '', createdId: '', createdUnit: '', transferDecided: false, transfer: null });
  const draft = key => drafts.get(key) || blank();
  const remember = input => {
    const key = input.dataset.workerKey;
    if (!key) return;
    const record = drafts.get(key) || blank();
    if (record.value !== input.value) { record.transferDecided = false; record.transfer = null; delete input.dataset.transferDecided; delete input.dataset.transfer; }
    record.value = input.value;
    if (input.dataset.createdId) record.createdId = input.dataset.createdId;
    if (input.dataset.createdUnit) record.createdUnit = input.dataset.createdUnit;
    if (input.dataset.transferDecided) { record.transferDecided = true; record.transfer = input.dataset.transfer || null; }
    record.input = input;
    drafts.set(key, record);
  };
  const restore = input => {
    const record = draft(input.dataset.workerKey);
    input.value = record.value;
    if (record.createdId) input.dataset.createdId = record.createdId;
    if (record.createdUnit) input.dataset.createdUnit = record.createdUnit;
    if (record.transferDecided) { input.dataset.transferDecided = '1'; if (record.transfer) input.dataset.transfer = record.transfer; }
  };
  const clear = (input, refresh = true) => {
    const created = draft(input.dataset.workerKey).createdId;
    drafts.delete(input.dataset.workerKey);
    for (const key of ['createdId', 'createdUnit', 'transferDecided', 'transfer']) delete input.dataset[key];
    input.value = '';
    if (created && refresh) changed();
  };
  const close = () => { generation++; node?.remove(); node = null; };
  return {
    draft,
    remember,
    clear,
    quickPending() { return quickInFlight > 0 || [...drafts.values()].some(record => record.createdId && record.input?.isConnected); },
    async open(context = {}, anchor) {
      if (destroyed) return;
      close(); const own = generation;
      const body = h('div', null, busyBlock('Загружаю категории'));
      node = section({ title: 'Добавить ' + (kind === 'pipe' ? 'трубу' : 'лист'), fixed: true, body });
      node.dataset.workerEntry = kind;
      const row = anchor?.closest('tr');
      if (row) { const entry = h('tr', { class: 'pg-worker-detail' }, h('td', { colspan: row.children.length }, node)); row.after(entry); node = entry; }
      else host.append(node);
      try {
        const zone = getZone(); if (!zone?.id) throw new Error('Складская зона ещё не загружена. Повторите.');
        const response = await api('/stock/categories', { query: { zoneId: zone.id } });
        if (own !== generation || destroyed) return;
        const categories = (response.items || []).filter(item => item.id !== 'none' && (kind === 'pipe' ? /труб/i : /лист/i).test(item.name));
        let created = null, submitting = false, plan = null;
        const controls = {}, fields = [];
        const make = (key, label, value = '', fixed = false) => {
          if (fixed && value !== '' && value != null) { controls[key] = { value: String(value) }; fields.push(h('p', null, h('span', { class: 'muted' }, label + ': '), h('strong', null, String(value)))); return; }
          const field = textInput({ label, value: value == null ? '' : String(value), inputmode: ['unit', 'materialGrade'].includes(key) ? 'text' : 'decimal', onInput: () => reset() });
          controls[key] = field.input; fields.push(field.el);
        };
        const category = select({ label: 'Категория', value: context.categoryId || '', options: [['', 'Выберите категорию'], ...categories.map(item => [item.id, item.name])], onChange: () => reset() });
        category.setAttribute('aria-label', 'Категория'); enhanceSelect(category); controls.categoryId = category;
        const shape = kind === 'pipe' ? select({ label: 'Сечение', value: context.shape || '', options: [['', 'Выберите сечение'], ['rect', 'Профильная'], ['round', 'Круглая']], onChange: () => { syncAxes(); reset(); } }) : null;
        if (shape) { shape.setAttribute('aria-label', 'Вид сечения'); enhanceSelect(shape); }
        make('unit', 'Единица учёта', context.unit || '', Boolean(context.unit));
        make('materialGrade', 'Марка (необязательно)', context.materialGrade || '', Boolean(context.materialGrade));
        const labels = { width: 'Ширина, мм', height: 'Высота, мм', diameter: 'Диаметр, мм', thickness: 'Толщина, мм', length: 'Длина, мм' };
        const axes = {};
        for (const key of kind === 'pipe' ? ['width', 'height', 'diameter', 'thickness', 'length'] : ['thickness', 'width', 'length']) {
          const before = fields.length; make(key, labels[key], context.dims?.[key], Number(context.dims?.[key]) > 0); axes[key] = fields[before];
        }
        const wash = kind === 'pipe' ? select({ label: 'Мойка', value: context.washed === true ? '1' : context.washed === false ? '0' : '', options: [['', 'Не указана'], ['1', 'Мытая'], ['0', 'Не мытая']], onChange: () => reset() }) : null;
        if (wash) { wash.setAttribute('aria-label', 'Мойка'); enhanceSelect(wash); }
        const amount = textInput({ label: kind === 'pipe' ? 'Начальный остаток, шт' : 'Начальный остаток', value: '0', inputmode: kind === 'pipe' ? 'numeric' : 'decimal', onInput: () => reset() });
        amount.input.dataset.workerInitial = '1';
        const preview = h('p', { role: 'status' }), errorBox = h('div');
        const read = () => ({ categoryId: category.value, unit: controls.unit.value, materialGrade: controls.materialGrade.value, shape: shape?.value,
          washed: wash?.value === '1' ? true : wash?.value === '0' ? false : null, assortment: context.assortment || '',
          dims: Object.fromEntries(Object.keys(axes).map(key => [key, controls[key].value])) });
        function reset() { if (created || submitting) return; plan = null; submit.textContent = 'Проверить'; preview.textContent = ''; errorBox.replaceChildren(); }
        function syncAxes() { for (const [key, field] of Object.entries(axes)) field.hidden = kind === 'pipe' && (shape.value === 'round' ? ['width', 'height'].includes(key) : key === 'diameter'); }
        const cancel = button({ label: 'Отмена', onClick: () => { if (!submitting) close(); } });
        const submit = button({ label: 'Проверить', kind: 'primary', onClick: async () => {
          if (submitting || destroyed) return;
          errorBox.replaceChildren();
          try {
            if (!plan) {
              const dto = workerCreateBody(read(), kind, categories), value = amount.input.value.trim();
              const quantity = workerInputQuantity(dto, value, kind);
              plan = { dto, value, quantity };
              const metres = kind === 'pipe' ? workerPipeMetres({ ...dto, quantity }) : null;
              const amountLabel = kind === 'pipe' ? `${qty(Number(value))} шт${metres == null ? '' : ` = ${qty(metres)} м`}` : `${qty(quantity)} ${dto.unit}`;
              preview.textContent = `${dto.name} · 0 → ${amountLabel}. Создать материал?`;
              submit.textContent = 'Сохранить'; return;
            }
            submitting = true; submit.disabled = cancel.disabled = true; body.classList.add('is-busy');
            for (const input of body.querySelectorAll('input,select')) input.disabled = true;
            if (!created) created = await api('/stock/items', { method: 'POST', query: { zoneId: zone.id }, body: plan.dto });
            if (own !== generation || destroyed) return;
            if (plan.quantity !== 0) await api('/stock/batch', { method: 'POST', body: workerCountBody({ ...plan.dto, ...created }, plan.value, kind === 'pipe' ? 'Трубы' : 'Листовой материал', kind) });
            if (own === generation && !destroyed) { close(); changed(); }
          } catch (error) {
            if (own !== generation || destroyed) return;
            if (created) { preview.textContent = `Материал создан, остаток0 ${workerUnit(created)}. Повторите сохранение остатка.`; submit.textContent = 'Сохранить остаток'; }
            errorBox.replaceChildren(failBlock(error, null));
          } finally {
            submitting = false;
            if (own === generation && !destroyed) {
              submit.disabled = cancel.disabled = false; body.classList.remove('is-busy');
              if (!created) for (const input of body.querySelectorAll('input,select')) input.disabled = false;
            }
          }
        } });
        body.replaceChildren(fieldRow(h('label', { class: 'field' }, h('span', null, 'Категория'), category), shape ? h('label', { class: 'field' }, h('span', null, 'Сечение'), shape) : null,
          wash ? h('label', { class: 'field' }, h('span', null, 'Мойка'), wash) : null, ...fields, amount.el), preview, toolbar(submit, cancel), errorBox);
        if (shape) syncAxes();
        body.addEventListener('keydown', event => {
          if (event.key === 'Escape' && !submitting) { event.preventDefault(); close(); }
          else if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); submit.click(); }
        });
        (body.querySelector('input') || category).focus();
      } catch (error) { if (own === generation && !destroyed) body.replaceChildren(failBlock(error, () => this.open(context, anchor)), button({ label: 'Отмена', onClick: close })); }
    },
    /**
     * Ячейка с готовым контекстом: спрашиваем только количество. Создание без формы;
     * Enter — создать, Escape — очистить. Ошибка остаётся в ячейке, повтор не создаёт дубль.
     */
    async quick(context, input) {
      if (destroyed || !input || input.disabled) return;
      restore(input);
      const cell = input.closest('td');
      const errorBox = cell?.querySelector('[data-worker-entry-error]');
      const show = (text) => { if (errorBox) { errorBox.textContent = text; errorBox.hidden = !text; } };
      if (cell?.querySelector('[data-worker-transfer]')) return; // ждём выбор переноса
      const raw = String(input.value || '').trim();
      if (!raw) { show(''); input.focus(); return; }
      let number;
      try { number = workerInputQuantity(context, raw, kind); }
      catch (error) { show(error.message); input.focus(); return; }
      const zone = getZone();
      if (!zone?.id) { show('Складская зона ещё не загружена. Повторите.'); return; }
      const unit = input.dataset.createdUnit || context.unit || '';
      const stored = input.dataset.transferDecided ? input.dataset.transfer : undefined;
      const transfer = stored ? JSON.parse(stored) : null;
      const run = async (move) => {
        let createdId = input.dataset.createdId || '';
        let completed = false;
        quickInFlight++;
        show(''); input.disabled = true; input.classList.add('is-busy');
        try {
          if (!createdId) {
            let body;
            try { body = workerCreateBody(context, kind, [{ id: context.categoryId, name: context.categoryName }]); }
            catch (error) { show(String(error?.message || 'Проверьте размеры.')); return; }
            const created = await api('/stock/items', { method: 'POST', query: { zoneId: zone.id }, body });
            if (destroyed) return;
            createdId = workerMaterialId(created);
            input.dataset.createdId = createdId;
            input.dataset.createdUnit = created.unit || body.unit;
            remember(input);
            if (created.countMode && created.countMode !== 'single') throw new Error('Материал создан, но у него общий остаток: количество меняйте в карточке.');
          }
          const lines = [];
          const quantity = workerInputQuantity({ ...context, unit: input.dataset.createdUnit || unit }, raw, kind);
          if (quantity !== 0) lines.push({ materialId: createdId, qty: quantity, expected: 0 });
          if (move) lines.push({ materialId: move.materialId, qty: move.expected - move.qty, expected: move.expected });
          if (lines.length) await api('/stock/batch', { method: 'POST', body: { type: 'count', note: kind === 'pipe' ? 'Трубы' : 'Листовой материал', lines } });
          if (destroyed) return;
          clear(input, false); completed = true;
        } catch (error) {
          if (destroyed) return;
          remember(input);
          show(createdId ? 'Материал создан, количество не сохранено. Enter — повторить остаток.' : String(error?.message || 'Не удалось создать материал.'));
        } finally {
          quickInFlight--;
          if (!destroyed) {
            input.disabled = false; input.classList.remove('is-busy');
            if (document.activeElement === document.body || document.activeElement === input) input.focus();
            if (completed) changed();
          }
        }
      };
      // В «Мытая» вписали количество, а в «Не мытая» того же размера есть остаток — предлагаем перенос.
      const other = !input.dataset.transferDecided && number > 0 ? counterpart?.(context) : null;
      const proposed = workerPipeTransfer(context, number, other);
      if (proposed) {
        const decide = move => {
          input.dataset.transferDecided = '1';
          input.dataset.transfer = move ? JSON.stringify(move) : '';
          remember(input);
          panel.remove(); run(move);
        };
        const panel = h('div', { class: 'pg-worker-confirm', 'data-worker-transfer': '1', role: 'group', 'aria-label': 'Перенос из не мытой' },
          h('strong', null, `В «Не мытая» ${qty(other.quantity)} ${workerUnit(other)}. Списать ${qty(proposed.pieces)} шт?`),
          toolbar(button({ label: `Списать ${qty(proposed.pieces)} шт`, kind: 'primary', onClick: () => decide(proposed) }),
            button({ label: 'Только добавить', kind: 'ghost', onClick: () => decide(null) }),
            button({ label: 'Отмена', kind: 'ghost', onClick: () => { panel.remove(); show(''); input.focus(); } })));
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); panel.remove(); show(''); input.focus(); } });
        cell.append(panel); panel.querySelector('button')?.focus();
        return;
      }
      await run(transfer);
    },
    preserve() { if (node?.tagName === 'TR') { const form = node.querySelector('[data-worker-entry]'); node.remove(); node = form; } if (node) host.append(node); },
    destroy() { destroyed = true; close(); },
  };
}
