import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { button, section, fieldRow, textInput, toolbar, select, enhanceSelect, busyBlock, failBlock } from '../ui/kit/index.js';
import { workerCreateBody, workerCountBody, workerInputQuantity, workerPipeMetres, workerUnit } from './stock-worker-model.js';

/** Компактное создание в явной зоне. Успешный create не повторяется при ошибке count. */
export function workerCreate({ kind, getZone, host, changed }) {
  let generation = 0, node = null, destroyed = false;
  const createdCells = new Map();
  const close = () => { generation++; node?.remove(); node = null; };
  return {
    clear(input) {
      if (createdCells.delete(input.dataset.workerKey)) changed();
    },
    quickPending() { return [...createdCells.values()].some(entry => entry.input.isConnected); },
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
    /** Повтор после частичного сбоя отправляет только пересчёт уже созданного материала. */
    async quick(context, input, value) {
      if (destroyed) return;
      workerInputQuantity(context, value, kind);
      const zone = getZone();
      if (!zone?.id) throw new Error('Складская зона ещё не загружена. Повторите.');
      const key = input.dataset.workerKey;
      let entry = createdCells.get(key);
      if (!entry) {
        const dto = workerCreateBody(context, kind, [{ id: context.categoryId, name: context.categoryName }]);
        const created = await api('/stock/items', { method: 'POST', query: { zoneId: zone.id }, body: dto });
        if (destroyed) return;
        entry = { item: { ...dto, ...created, quantity: 0 }, input };
        createdCells.set(key, entry);
      }
      try {
        const body = workerCountBody(entry.item, value, 'Трубы', kind);
        if (body.lines[0].qty !== 0) await api('/stock/batch', { method: 'POST', body });
      } catch (error) {
        const action = entry.item.countMode === 'single' ? 'Enter — повторить. Escape — обновить таблицу.' : 'Откройте карточку материала для пересчёта.';
        throw new Error('Материал создан, количество не сохранено. ' + action, { cause: error });
      }
      if (destroyed) return;
      createdCells.delete(key);
      changed();
    },
    preserve() { if (node?.tagName === 'TR') { const form = node.querySelector('[data-worker-entry]'); node.remove(); node = form; } if (node) host.append(node); },
    destroy() { destroyed = true; createdCells.clear(); close(); },
  };
}
