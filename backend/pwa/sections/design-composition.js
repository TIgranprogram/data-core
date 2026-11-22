import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';
import { canFollow } from '../core/route-access.js';
import { actions, button, confirmDlg, empty, failBlock, field, hint, section, select, stack, textInput, toast, toastError } from '../ui/kit/index.js';
import { attachCombo } from '../ui/kit/pick.js';
import { toggle } from '../ui/kit/guide.js';
import { compositionCatalog, describeCompositionLine } from './comp-editor.js';
import { productAttachmentsBlock } from './product-attachments.js';
import { lineFilesCard } from './order-line-files.js';

const idOf = (x) => typeof x === 'object' && x ? String(x.id || x._id || '') : String(x || '');
const items = (value) => Array.isArray(value) ? value : value.items || [];
const sorted = (rows) => items(rows).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
const url = (base, id) => base + '/' + encodeURIComponent(id);

export function designComposition(row) {
  const productId = row.production?.productId || row.productId;
  const can = session.canEdit && !['contract-closed', 'cancelled'].includes(row.production?.state) && row.status !== 'cancelled';
  const content = stack();
  const card = section({ title: 'Состав изделия', tone: 'main', open: true, body: content });
  if (!productId) {
    content.append(hint('Сопоставьте позицию с изделием, чтобы вести модули и детали.'));
    return card;
  }
  const product = url('/products', productId);
  const workflow = url('/work-tasks/design', row.id);
  const expanded = new Set();
  let catalog, root = [], release = new Map(), allowed = false, workTypes, rootLegacy = false;

  async function run(control, request, refresh = load) {
    if (control.dataset.saving) return;
    control.dataset.saving = '1';
    control.disabled = true;
    try { await request(); await refresh(); }
    catch (error) { toastError(error); }
    finally { delete control.dataset.saving; control.disabled = false; }
  }

  function addRow(owner, isModule, lines, refresh) {
    const box = stack();
    const kind = select({ label: 'Что добавить', value: isModule ? 'part' : 'module',
      options: isModule ? [{ value: 'part', label: 'Деталь' }] : [{ value: 'module', label: 'Модуль' }, { value: 'part', label: 'Деталь' }],
      onChange: show });
    function show() {
      const name = textInput({ label: 'Название или обозначение' });
      const quantity = textInput({ label: 'Количество на 1 шт.', value: '1', inputmode: 'decimal', short: true });
      const type = kind.value || (isModule ? 'part' : 'module');
      let selected;
      const add = button({ label: 'Добавить в состав', kind: 'primary', size: 'S', disabled: true, onClick: (event) => {
        const count = parseNum(quantity.input.value);
        if (!selected || !(count > 0)) { toast('Выберите позицию и укажите количество больше нуля'); return; }
        run(event.currentTarget, () => api(owner + '/composition', { method: 'POST', body: {
          lineType: type === 'module' ? 'module' : 'material', refId: selected, quantity: count,
          sortOrder: Math.max(-1, ...lines.map((line) => line.sortOrder ?? 0)) + 1,
        } }), refresh);
      } });
      attachCombo(name.input, {
        options: () => (catalog.lists[type] || []).map((choice) => ({ value: choice.id, label: choice.label })),
        onPick: (choice) => { selected = choice.value ?? choice.id; add.disabled = !selected; },
      });
      name.input.addEventListener('input', () => { selected = ''; add.disabled = true; });
      box.replaceChildren(name.el, quantity.el, add);
    }
    show();
    return section({ title: isModule ? 'Добавить деталь' : 'Добавить модуль или деталь', tone: 'neutral', body: stack(isModule ? null : field('Что добавить', kind), box) });
  }

  function reorder(lines, index, direction, moduleId) {
    const changed = lines.map(idOf);
    const next = index + direction;
    [changed[index], changed[next]] = [changed[next], changed[index]];
    return api(workflow + '/composition', { method: 'PATCH', body: {
      action: 'reorder', ...(moduleId ? { fromModuleId: moduleId } : {}), order: changed,
    } });
  }

  function arrows(lines, index, moduleId, refresh) {
    if (!can || !moduleId && rootLegacy || lines.some((line) => !idOf(line))) return null;
    return actions(
      button({ label: '↑', title: 'Выше в составе', size: 'S', disabled: index === 0, onClick: (e) => run(e.currentTarget, () => reorder(lines, index, -1, moduleId), refresh) }),
      button({ label: '↓', title: 'Ниже в составе', size: 'S', disabled: index >= lines.length - 1, onClick: (e) => run(e.currentTarget, () => reorder(lines, index, 1, moduleId), refresh) }),
    );
  }

  function moveDetail(line, name, moduleId) {
    if (!can || !idOf(line)) return null;
    const targets = root.filter((entry) => entry.lineType === 'module' && idOf(entry.refId) !== moduleId);
    const options = [{ value: '', label: 'Выберите место' }, ...(moduleId ? [{ value: 'product', label: 'На уровень изделия' }] : []),
      ...targets.map((entry) => ({ value: idOf(entry.refId), label: describeCompositionLine(entry, catalog).name }))];
    if (options.length === 1) return null;
    let where;
    const destination = select({ label: 'Куда перенести деталь', value: '', options, onChange: (v) => { where = v; move.disabled = !where; } });
    const move = button({ label: 'Перенести', size: 'S', disabled: true, onClick: async (e) => {
      const control = e.currentTarget;
      if (!(await confirmDlg('Перенести деталь?', name + '. Состав общего модуля изменится во всех изделиях, где он используется.', { okText: 'Перенести' }))) return;
      await run(control, () => api(workflow + '/composition', { method: 'PATCH', body: {
        action: 'move', lineId: idOf(line), ...(moduleId ? { fromModuleId: moduleId } : {}), ...(where === 'product' ? {} : { toModuleId: where }),
      } }));
    } });
    return section({ title: 'Переместить деталь', body: stack(field('Куда перенести', destination), move) });
  }

  function simpleLine(line, siblings, index, moduleId, refresh, editable = true) {
    const info = describeCompositionLine(line, catalog);
    return section({
      title: info.name, count: qty(line.quantity) + ' ' + (line.unit || 'шт'),
      side: editable ? arrows(siblings, index, moduleId, refresh) : null,
      body: stack(hint([info.word, info.sub].filter(Boolean).join(' · ')),
        editable && info.word === 'Деталь' ? moveDetail(line, info.name, moduleId) : null),
    });
  }

  function routeEditor(module, owner, refresh) {
    const current = sorted(module.workTypes || []);
    const kindId = (entry) => idOf(entry.workTypeId);
    const titles = new Map(workTypes.map((entry) => [idOf(entry), entry.name]));
    const route = current.map((entry) => ({ workTypeId: kindId(entry), estimatedHours: entry.estimatedHours ?? 0,
      ...(entry.days != null ? { days: entry.days } : {}) })).filter((entry) => entry.workTypeId);
    const save = (next) => api(owner, { method: 'PATCH', body: { workTypes: next.map((entry, sortOrder) => ({ ...entry, sortOrder })) } });
    const rows = current.map((entry) => {
      const id = kindId(entry);
      return actions(h('span', null, entry.workTypeId?.name || titles.get(id) || 'Вид работ удалён'),
        can ? button({ label: 'Убрать', kind: 'ghost', size: 'S', onClick: (e) => run(e.currentTarget, () => save(route.filter((item) => item.workTypeId !== id)), refresh) }) : null);
    });
    let selected;
    const choices = workTypes.filter((entry) => !route.some((item) => item.workTypeId === idOf(entry)));
    const add = button({ label: 'Добавить вид работ', size: 'S', disabled: true, onClick: (e) => run(e.currentTarget,
      () => save([...route, { workTypeId: selected }]), refresh) });
    const picker = can && choices.length ? actions(select({ label: 'Вид работ', value: '', options: [{ value: '', label: 'Выберите вид работ' },
      ...choices.map((entry) => ({ value: idOf(entry), label: entry.name }))], onChange: (value) => { selected = value; add.disabled = !value; } }), add) : null;
    return section({ title: 'Виды работ', tone: 'work', open: true, body: stack(
      ...(rows.length ? rows : [hint('Маршрут модуля пока пуст.')]), picker) });
  }

  function handover(line) {
    const id = idOf(line);
    const state = release.get(id);
    if (state?.task) {
      const href = '#work?open=' + encodeURIComponent(state.task.id);
      const text = (state.task.status === 'done' ? 'Модуль готов' : 'Передано в работу') + ' · ' + state.task.code;
      return canFollow(session, href) ? h('a', { href }, text) : hint(text);
    }
    if (!allowed || !state || !can) return null;
    const endpoint = workflow + '/modules/' + encodeURIComponent(id);
    if (!state.hasRoute) return hint('Для передачи добавьте виды работ.');
    const ready = toggle({ label: 'Готово к работе', checked: state.ready, onChange: (checked) => {
      const control = ready.querySelector('input');
      control.checked = state.ready;
      run(control, () => api(endpoint, { method: 'PATCH', body: { ready: checked } }));
    } });
    return actions(ready,
      button({ label: 'Передать модуль в работу', kind: 'primary', size: 'S', disabled: !state.ready,
        onClick: (e) => run(e.currentTarget, async () => {
          const task = await api(endpoint + '/launch', { method: 'POST', body: {} });
          toast('Модуль передан · ' + task.code);
          window.dispatchEvent(new Event('data-changed'));
        }) }));
  }

  function prepareLegacy(moduleId) {
    return can ? button({ label: 'Подготовить старый состав к правке', size: 'S', onClick: (e) => run(e.currentTarget,
      () => api(workflow + '/composition', { method: 'PATCH', body: { action: 'materialize', ...(moduleId ? { fromModuleId: moduleId } : {}) } })) }) : null;
  }

  function moduleLine(line, index) {
    const moduleId = idOf(line.refId);
    const id = idOf(line) || moduleId;
    const info = describeCompositionLine(line, catalog);
    const owner = url('/modules', moduleId);
    const body = stack();
    const block = section({ title: info.name, count: qty(line.quantity) + ' шт', tone: 'main',
      open: expanded.has(id), side: arrows(root, index, null, load), body });
    async function loadModule() {
      body.replaceChildren(hint('Загружаю состав модуля…'));
      try {
        if (!workTypes) workTypes = items(await api('/work-types'));
        const [detail, response] = await Promise.all([api(owner), api(owner + '/composition')]);
        const lines = sorted(response);
        const legacy = !detail.composition?.length && !!detail.materials?.length;
        body.replaceChildren(hint(info.sub || 'Модуль'), routeEditor(detail, owner, load),
          ...lines.map((child, childIndex) => simpleLine(child, lines, childIndex, moduleId, load, !legacy)),
          legacy && !rootLegacy ? prepareLegacy(moduleId) : null,
          can ? addRow(owner, true, lines, load) : null, handover(line));
      } catch (error) { body.replaceChildren(failBlock(error, loadModule)); }
    }
    block.addEventListener('toggle', () => {
      if (block.open && !expanded.has(id)) { expanded.add(id); loadModule(); }
      else if (!block.open) expanded.delete(id);
    });
    if (expanded.has(id)) loadModule();
    return block;
  }

  const files = row.incomeId && row.production?.productId
    ? lineFilesCard({ id: row.incomeId, orderId: row.orderId, productId }) : productAttachmentsBlock({ id: productId });
  async function load() {
    try {
      const [dictionary, lines, state] = await Promise.all([
        compositionCatalog(), api(product + '/composition'), api(workflow + '/modules'),
      ]);
      catalog = dictionary;
      root = sorted(lines);
      release = new Map((state.items || []).map((item) => [item.lineId, item]));
      allowed = !!state.editable;
      rootLegacy = !!state.legacyComposition;
      content.replaceChildren(...root.map((line, index) => line.lineType === 'module' ? moduleLine(line, index) : simpleLine(line, root, index, null, load)),
        !root.length ? empty({ title: 'Состав пока пуст' }) : null,
        rootLegacy ? prepareLegacy(null) : null,
        can ? addRow(product, false, root, load) : null, files);
    } catch (error) { content.replaceChildren(failBlock(error, load)); }
  }
  content.append(hint('Загружаю состав…'));
  load();
  return card;
}
