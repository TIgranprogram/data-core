import { h } from '../../../core/dom.js';
import { actions, busyBlock, button, buildForm, confirmDlg, guide, hint, section, sideNote, similarBox, toast, toastError } from '../../../ui/kit/index.js';
import { assignSku, createProduct, patchProduct, formValues, getProduct } from '../../products/data.js';
import { createSession, facetsForGroup } from '../../products/create-session.js';
import { setFacets } from './api.js';

/**
 * «+ Новое изделие» по ходу воронки: обязательно только название (и группа — она уже выбрана шагом 2).
 * Раздел ставится по группе, признаки — из шага 3, артикул — сервер (assign-sku). Перед «Создать» — «Похожее уже есть».
 *   newProduct({ group, facetIds, category, knownGroups, onCreated(prod), onPickExisting(item), onCancel, onFresh }) →
 *     { el, busy(), dirty(), partial(), setContext({ group, facetIds, category, knownGroups }) }
 * category — { code, label } выбранной выше категории; knownGroups — группы, которые в ней встречаются (шаг «Группа»).
 * C096 Э4: запись создана, а артикул/признаки не записались — partial(); та же форма продолжает эту запись, а не создаёт вторую.
 * Фото, размеры и вес можно добавить сейчас или позже в карточке изделия; без фото PDF не выйдет.
 */
export function newProduct({ group = '', facetIds = [], category = null, knownGroups = [], onCreated, onPickExisting, onCancel, onFresh }) {
  const el = h('div', null, busyBlock('форму'));
  let activeForm; let saving = false; let completed = false;
  const ctx = { group, facetIds, category, knownGroups };
  const partialBox = h('div');
  // body не уходит на сервер с полями воронки: они нужны только шагу заполнения (ValidationPipe отклонил бы лишнее)
  const save = createSession({
    create: ({ _sel, ...body }) => createProduct(body),
    update: (id, { _sel, ...body }) => patchProduct(id, body),
    complete: async (made, body) => {
      const chk = await assignSku(made.id);
      if (chk?.confirmRequired) await assignSku(made.id, true);
      await setFacets(made.id, facetsForGroup(body._sel.group, body.group, body._sel.facetIds));
      return getProduct(made.id);
    },
  });
  const paintPartial = () => {
    const made = save.partial();
    partialBox.replaceChildren(...(made ? [stackPartial(made)] : []));
  };
  const stackPartial = (made) => h('div', null,
    hint(`Изделие «${made.name || 'без названия'}» уже создано, но не заполнено. «Создать и продолжить» продолжит его.`, 'warn'),
    actions(
      button({ label: 'Открыть созданное изделие', size: 'S', onClick: () => { if (!saving) onPickExisting?.({ id: made.id }); } }),
      onFresh ? button({ label: 'Создать другое изделие', kind: 'ghost', size: 'S', onClick: () => { if (!saving) onFresh(); } }) : null,
    ));

  formValues().then((fv) => {
    const groups = fv.groups || [];
    const form = buildForm([
      { key: 'name', label: 'Название', required: true, wide: true, max: 500, placeholder: 'Как изделие называется в каталоге' },
      { key: 'group', label: 'Группа', type: 'combo', required: true, strict: true, strictText: 'Выберите группу из списка', options: groups.map((g) => ({ value: g.value, label: g.value, sub: g.section })), hint: group ? 'Подставлена из выбранного выше' : 'Определяет раздел каталога и тип паспорта' },
      { key: 'photos', label: 'Фото изделия', type: 'photos', wide: true, hint: 'Нужно для PDF — можно добавить позже' },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', hint: 'Нужен для PDF — можно добавить позже' },
    ], { group });
    activeForm = form;
    const sim = similarBox({ pickLabel: 'Взять это', onPick: async (it) => {
      if (saving) return;
      const made = save.partial();
      if (made && !(await confirmDlg('Взять другое изделие?', `«${made.name || 'Новое изделие'}» уже создано и останется в «Продукции» с незавершённым заполнением.`, { okText: 'Взять выбранное' }))) return;
      onPickExisting?.(it);
    } });
    const nameInput = form.el.querySelector('input'); // первое поле — название
    nameInput?.addEventListener('input', () => sim.check(nameInput.value));

    const create = button({ label: 'Создать и продолжить', kind: 'primary', onClick: async () => {
      if (saving) return;
      const r = form.read();
      if (r.errors) { toast('Заполните название и группу', { error: true }); return; }
      const v = r.values;
      const type = groups.find((g) => g.value === v.group)?.section;
      if (!type) { toast('Выберите группу из списка — по ней определяется раздел', { error: true }); return; }
      // C096 Э4: группа не встречается в выбранной выше категории — тип паспорта будет по группе; сказать до создания
      if (ctx.category?.code && ctx.knownGroups.length && !ctx.knownGroups.includes(v.group) && v.group !== ctx.group
        && !(await confirmDlg('Группа из другого типа паспорта?', `В типе «${ctx.category.label || ctx.category.code}» нет группы «${v.group}». Тип паспорта будет по группе; шаги выше обновятся.`, { okText: 'Создать в этой группе' }))) return;
      saving = true; create.disabled = true; el.classList.add('is-busy');
      const controls = [...form.el.querySelectorAll('input,textarea,select,button')].map((input) => ({ input, disabled: input.disabled }));
      controls.forEach(({ input }) => { input.disabled = true; });
      try {
        const made = await save({ name: v.name, group: v.group, type, status: 'draft', unit: 'шт', photoIds: v.photos || [], weightKg: v.weightKg ?? null, _sel: { group: ctx.group, facetIds: ctx.facetIds } });
        completed = true;
        window.dispatchEvent(new CustomEvent('data-changed'));
        onCreated?.(made);
      } catch (e) { toastError(e, 'создать изделие'); }
      finally { saving = false; create.disabled = false; el.classList.remove('is-busy'); controls.forEach(({ input, disabled }) => { input.disabled = disabled; }); paintPartial(); }
    } });
    el.replaceChildren(guide.steps([{ label: 'Название и группа', state: 'now' }, { label: 'Артикул — сам', state: 'later' }, { label: 'Остальное спросим', state: 'later' }]), partialBox, form.el, sim.el,
      actions(create, button({ label: 'Назад к списку', kind: 'ghost', onClick: () => onCancel?.() })));
    paintPartial();
  }).catch((e) => { el.replaceChildren(sideNote('Форма не загрузилась.'), button({ label: 'Назад', onClick: () => onCancel?.() })); toastError(e, 'открыть форму изделия'); });

  return {
    el: section({ title: 'Новое изделие', tone: 'main', open: true, body: el }),
    busy: () => saving,
    dirty: () => !completed && (!!save.partial() || !!activeForm?.dirty()),
    partial: () => (completed ? null : save.partial()),
    /** Возврат к отложенной форме: признаки и категория — текущего выбора воронки, а не того, что был при первом показе. */
    setContext: (next) => { Object.assign(ctx, next); },
  };
}
