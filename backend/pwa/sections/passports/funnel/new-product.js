import { h } from '../../../core/dom.js';
import { actions, busyBlock, button, buildForm, section, sideNote, similarBox, toast, toastError } from '../../../ui/kit/index.js';
import { assignSku, createProduct, formValues, getProduct } from '../../products/data.js';
import { setFacets } from './api.js';

/**
 * «+ Новое изделие» по ходу воронки: обязательно только название (и группа — она уже выбрана шагом 2).
 * Раздел ставится по группе, признаки — из шага 3, артикул — сервер (assign-sku). Перед «Создать» — «Похожее уже есть».
 *   newProduct({ group, facetIds, onCreated(prod), onPickExisting(item), onCancel }) → { el }
 * Фото, размеры и вес можно добавить сейчас или позже в карточке изделия; без фото PDF не выйдет.
 */
export function newProduct({ group = '', facetIds = [], onCreated, onPickExisting, onCancel }) {
  const el = h('div', null, busyBlock('форму'));

  formValues().then((fv) => {
    const groups = fv.groups || [];
    const form = buildForm([
      { key: 'name', label: 'Название', required: true, wide: true, max: 500, placeholder: 'Как изделие называется в каталоге' },
      { key: 'group', label: 'Группа', type: 'combo', required: true, strict: true, strictText: 'Выберите группу из списка', options: groups.map((g) => ({ value: g.value, label: g.value, sub: g.section })), hint: group ? 'Подставлена из выбранного выше' : 'Определяет раздел каталога и категорию паспорта' },
      { key: 'photos', label: 'Фото изделия', type: 'photos', wide: true, hint: 'Можно добавить позже, но без фото PDF не выйдет' },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', hint: 'Нужен для паспорта — можно позже' },
    ], { group });
    const sim = similarBox({ pickLabel: 'Взять это', onPick: (it) => onPickExisting?.(it) });
    const nameInput = form.el.querySelector('input'); // первое поле — название
    nameInput?.addEventListener('input', () => sim.check(nameInput.value));

    const create = button({ label: 'Создать и продолжить', kind: 'primary', onClick: async () => {
      const r = form.read();
      if (r.errors) { toast('Заполните название и группу', { error: true }); return; }
      const v = r.values;
      const type = groups.find((g) => g.value === v.group)?.section;
      if (!type) { toast('Выберите группу из списка — по ней определяется раздел', { error: true }); return; }
      try {
        const made = await createProduct({ name: v.name, group: v.group, type, status: 'draft', unit: 'шт', photoIds: v.photos || [], weightKg: v.weightKg ?? null });
        const chk = await assignSku(made.id);
        if (chk?.confirmRequired) await assignSku(made.id, true);
        if (facetIds.length) await setFacets(made.id, facetIds);
        window.dispatchEvent(new CustomEvent('data-changed'));
        onCreated?.(await getProduct(made.id));
      } catch (e) { toastError(e, 'создать изделие'); }
    } });
    el.replaceChildren(sideNote('Нужно только название. Артикул поставится сам, признаки возьмутся из выбранного выше.'), form.el, sim.el,
      actions(create, button({ label: 'Назад к списку', kind: 'ghost', onClick: () => onCancel?.() })));
  }).catch((e) => { el.replaceChildren(sideNote('Форма не загрузилась.'), button({ label: 'Назад', onClick: () => onCancel?.() })); toastError(e, 'открыть форму изделия'); });

  return { el: section({ title: 'Новое изделие', tone: 'main', open: true, body: el }) };
}
