/**
 * C141: правка полей изделия прямо в правой колонке книжки — без openSide / ухода в «Настройки».
 * Материалы, части, габариты, монтаж, состав — всё в sideSlot.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button, hint } from '../../ui/kit/index.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { loadMaterialDicts, materialsSpec, fromComposition } from '../products/form-fields.js';
import { fromAnalog } from '../products/tech-analogs.js';
import { patchProduct } from '../products/data.js';
import { session } from '../../core/api.js';
import { sidePanel } from './book-shared.js';

/** Показать редактор materialsSpec в слоте книжки. onDone — после сохранения или «Назад». */
export async function openMaterialsInBook(slot, productId, { focusParts = false, onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю таблицу материалов…'));
  try {
    const [prod, dicts] = await Promise.all([api(`/showcase/${productId}`), loadMaterialDicts()]);
    let specW = null;
    const paint = () => {
      specW = materialsSpec({
        value: prod.materialsSpec ? JSON.stringify(prod.materialsSpec) : '',
        dicts,
        text: prod.materialsText || '',
        scope: () => prod.passportCategory?.code || '',
        actions: session.canEdit ? [fromComposition(prod), fromAnalog(prod)] : [],
      });
      const save = button({
        label: 'Сохранить в изделие',
        kind: 'primary',
        size: 'S',
        disabled: !session.canEdit,
        onClick: async () => {
          try {
            const body = { materialsSpec: specW.value ? JSON.parse(specW.value) : null };
            await patchProduct(productId, body);
            prod.materialsSpec = body.materialsSpec;
            toast('Материалы сохранены в изделие — паспорт возьмёт их при следующей сборке текстов.');
            onDone?.({ saved: true });
          } catch (e) { toastError(e, 'сохранить материалы'); }
        },
      });
      const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) });
      slot.replaceChildren(sidePanel(focusParts ? 'Части у материалов' : 'Материалы изделия',
        hint(focusParts
          ? 'У каждой строки укажите часть (стойка, перекладина…). Книжку не закрываем.'
          : 'Таблица как в техописании — правка здесь, без перехода в настройки.'),
        specW.el,
        h('div', { class: 'bk-ed-row' }, save, back),
      ));
      if (focusParts) {
        requestAnimationFrame(() => {
          const row = slot.querySelector('[data-parts], .ms-parts, select, .k-select');
          row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        });
      }
    };
    paint();
  } catch (e) {
    toastError(e, 'открыть материалы');
    slot.replaceChildren(h('p', { class: 'hint' }, 'Не удалось загрузить материалы.'),
      button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) }));
  }
}

/** Короткая форма габаритов/веса в слоте книжки. */
export async function openDimsInBook(slot, productId, { onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const prod = await api(`/showcase/${productId}`);
    const d = prod.dimensions || {};
    const { buildForm } = await import('../../ui/kit/form.js');
    const form = buildForm([
      { key: 'length', label: 'Длина, мм', type: 'number', min: 0 },
      { key: 'width', label: 'Ширина, мм', type: 'number', min: 0 },
      { key: 'height', label: 'Высота, мм', type: 'number', min: 0 },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', min: 0 },
    ], { length: d.length || '', width: d.width || '', height: d.height || '', weightKg: prod.weightKg || '' });
    const save = button({
      label: 'Сохранить в изделие', kind: 'primary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          const v = form.values;
          await patchProduct(productId, {
            dimensions: { length: +v.length || 0, width: +v.width || 0, height: +v.height || 0, unit: d.unit || 'мм' },
            weightKg: +v.weightKg || 0,
          });
          toast('Габариты и вес записаны в изделие.');
          onDone?.({ saved: true });
        } catch (e) { toastError(e, 'сохранить габариты'); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) });
    slot.replaceChildren(sidePanel('Габариты и вес',
      hint('Правка в книжке — без перехода в карточку изделия.'),
      form.el,
      h('div', { class: 'bk-ed-row' }, save, back),
    ));
  } catch (e) {
    toastError(e, 'открыть габариты');
    onDone?.({ saved: false });
  }
}

/** Текст монтажа изделия (поле installation). */
export async function openInstallationInBook(slot, productId, { onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const prod = await api(`/showcase/${productId}`);
    const { buildForm } = await import('../../ui/kit/form.js');
    const form = buildForm(
      [{ key: 'installation', label: 'Монтаж', type: 'textarea', rows: 4, wide: true, max: 1000 }],
      { installation: prod.installation || '' },
    );
    const save = button({
      label: 'Сохранить в изделие', kind: 'primary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          await patchProduct(productId, { installation: form.values.installation || '' });
          toast('Монтаж записан в изделие.');
          onDone?.({ saved: true });
        } catch (e) { toastError(e, 'сохранить монтаж'); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) });
    slot.replaceChildren(sidePanel('Монтаж',
      hint('Текст монтажа изделия — в книжке, без перехода в карточку.'),
      form.el,
      h('div', { class: 'bk-ed-row' }, save, back),
    ));
  } catch (e) {
    toastError(e, 'открыть монтаж');
    onDone?.({ saved: false });
  }
}

/** Состав изделия — дерево + воронка (C142), без ухода из книжки. */
export async function openCompositionInBook(slot, productId, { onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю состав…'));
  try {
    const { mountCompositionFunnel } = await import('./book-composition-funnel.js');
    await mountCompositionFunnel(slot, productId, { onDone });
  } catch (e) {
    slot.closest?.('.bk-side')?.classList.remove('is-wide');
    toastError(e, 'открыть состав');
    slot.replaceChildren(
      h('p', { class: 'hint' }, 'Не удалось открыть состав.'),
      button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) }),
    );
  }
}
