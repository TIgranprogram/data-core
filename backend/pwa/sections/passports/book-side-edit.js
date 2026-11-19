/**
 * C141/C143: правка полей изделия в правой колонке книжки — без ухода в карточку.
 * Материалы, части, габариты, монтаж (+ способ и глубина Г), назначение, числа passport-defaults, состав.
 */
import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button } from '../../ui/kit/index.js';
import { busyBtn } from '../../ui/kit/busy.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { loadMaterialDicts, materialsSpec, fromComposition } from '../products/form-fields.js';
import { fromAnalog } from '../products/tech-analogs.js';
import { patchProduct } from '../products/data.js';
import { sidePanel, aiFocusPrompt, copyAiText } from './book-shared.js';

/** Снимок таблицы материалов для мини-промпта ИИ. */
function materialsAiContext(prod, dicts, specW) {
  const matBy = new Map((dicts.mats || []).map((m) => [String(m.id), m]));
  const partBy = new Map((dicts.parts || []).map((p) => [String(p.id), p]));
  const sp = specW?.spec?.() || prod.materialsSpec || { rows: [] };
  const rows = Array.isArray(sp.rows) ? sp.rows : [];
  const rowsText = rows.length
    ? rows.map((r, i) => {
      const parts = (r.partIds || []).map((id) => partBy.get(String(id))?.name || id).filter(Boolean).join(', ') || '—';
      const mat = matBy.get(String(r.materialId || ''))?.name || '—';
      const sizes = (r.sizes || []).join('; ') || '—';
      return `${i + 1}. часть: ${parts}; материал: ${mat}; размеры: ${sizes}`;
    }).join('\n')
    : '';
  const cat = prod.passportCategory?.code || '';
  // части — строго (пусто ≠ для всех); материалы — пусто = для всех; без hideInNew
  const allowParts = (dicts.parts || [])
    .filter((p) => cat && String(p.categories || '').split(/[,;\s]+/).filter(Boolean).includes(cat))
    .map((p) => p.name).filter(Boolean);
  const allowMats = (dicts.mats || [])
    .filter((m) => m.kind !== 'coating' && m.hideInNew !== true && m.hideInNew !== 'true')
    .filter((m) => {
      if (!cat) return true;
      const list = String(m.categories || '').split(/[,;\s]+/).filter(Boolean);
      return !list.length || list.includes(cat);
    })
    .map((m) => m.name).filter(Boolean);
  const productLabel = [prod.article, prod.name].filter(Boolean).join(' — ') || prod.id;
  return { productLabel, rowsText, allowParts, allowMats };
}

/** Кнопка «Промпт по фото» в панели правки (общий ИИ скрыт при .is-editing). */
function focusAiBtn(kind, buildCtx, statusEl) {
  const labels = {
    parts: 'Промпт: части по фото',
    materials: 'Промпт: материалы по фото',
    dims: 'Промпт: габариты по фото',
    install: 'Промпт: монтаж по фото',
  };
  return button({
    label: labels[kind] || 'Промпт по фото',
    kind: 'ghost',
    size: 'S',
    title: 'Скопировать узкое задание: в чат ИИ + фото → точные тексты для вставки',
    onClick: async () => {
      const ctx = typeof buildCtx === 'function' ? buildCtx() : (buildCtx || {});
      statusEl.textContent = await copyAiText(aiFocusPrompt({ kind, ...ctx }));
    },
  });
}

/** Режим правки в правой колонке: скрыть ИИ/Inventor; wide — только материалы/состав (C143). */
export function setSideWide(slot, on, { editing = on } = {}) {
  const side = slot?.closest?.('.bk-side');
  const main = side?.closest?.('.bk-main');
  side?.classList.toggle('is-wide', !!on);
  side?.classList.toggle('is-editing', !!editing);
  main?.classList.toggle('is-edit-wide', !!on);
}

/** Любой короткий слот (габариты, монтаж…) — узкая колонка, без ИИ снизу. */
function beginEdit(slot) {
  const token = Symbol();
  slot._bkOpening = token;
  setSideWide(slot, false, { editing: true });
  return () => slot.isConnected && slot._bkOpening === token;
}
function endEdit(slot) {
  slot._bkOpening = null;
  slot._bkLeave = null;
  setSideWide(slot, false, { editing: false });
}

function protectSide(slot, dirty, save, done) {
  slot._bkLeave = async () => !save.classList.contains('is-busy') && (!dirty() || await confirmDlg(
    'Выйти без сохранения?', 'В правой панели есть несохранённые изменения.', { okText: 'Выйти' }));
  return button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: async () => {
    if (await slot._bkLeave?.()) done({ saved: false });
  } });
}

/** Показать редактор materialsSpec в слоте книжки. onDone — после сохранения или «Назад». */
export async function openMaterialsInBook(slot, productId, { focusParts = false, onDone } = {}) {
  const isCurrent = beginEdit(slot);
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю таблицу материалов…'));
  setSideWide(slot, true, { editing: true });
  const done = (r) => { endEdit(slot); onDone?.(r); };
  try {
    const [prod, dicts] = await Promise.all([api(`/showcase/${productId}`), loadMaterialDicts()]);
    if (!isCurrent()) return;
    let specW = null;
    const paint = () => {
      specW = materialsSpec({
        value: prod.materialsSpec ? JSON.stringify(prod.materialsSpec) : '',
        dicts,
        text: prod.materialsText || '',
        scope: () => prod.passportCategory?.code || '',
        actions: session.canEdit ? [fromComposition(prod), fromAnalog(prod)] : [],
        preview: false, // текст уже на листе книжки — в колонке не дублируем
      });
      // secondary: единственная primary в окне — «Выпустить» (C143 UI-REVIEW)
      const initial = specW.value;
      const save = button({
        label: 'Сохранить в изделие',
        kind: 'secondary',
        size: 'S',
        disabled: !session.canEdit,
        onClick: async () => {
          const end = busyBtn(save);
          try {
            specW.validate();
            const body = { materialsSpec: specW.value ? JSON.parse(specW.value) : null };
            await patchProduct(productId, body);
            prod.materialsSpec = body.materialsSpec;
            toast('Материалы сохранены в изделие — паспорт возьмёт их при следующей сборке текстов.');
            done({ saved: true });
          } catch (e) { toastError(e, 'сохранить материалы'); }
          finally { end(); }
        },
      });
      const back = protectSide(slot, () => specW.value !== initial, save, done);
      const aiStatus = h('p', { class: 'hint bk-toc-hint', 'aria-live': 'polite' },
        'Нужны части/материалы с фото: скопируйте промпт → чат ИИ → прикрепите фото.');
      const aiBtn = focusAiBtn(focusParts ? 'parts' : 'materials', () => materialsAiContext(prod, dicts, specW), aiStatus);
      // кнопки сверху слота — всегда в кадре при прокрутке таблицы
      slot.replaceChildren(sidePanel('Описание конструкции и материалов',
        h('div', { class: 'bk-ed-row' }, save, back, aiBtn),
        aiStatus,
        specW.el,
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
    if (!isCurrent()) return;
    endEdit(slot);
    toastError(e, 'открыть материалы');
    slot.replaceChildren(h('p', { class: 'hint' }, 'Не удалось загрузить материалы.'),
      button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) }));
  }
}

/** Короткая форма габаритов/веса в слоте книжки. */
export async function openDimsInBook(slot, productId, { onDone } = {}) {
  const isCurrent = beginEdit(slot);
  const done = (r) => { endEdit(slot); onDone?.(r); };
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const prod = await api(`/showcase/${productId}`);
    const d = prod.dimensions || {};
    const { buildForm } = await import('../../ui/kit/form.js');
    if (!isCurrent()) return;
    const initial = { length: d.length ?? '', width: d.width ?? '', height: d.height ?? '', weightKg: prod.weightKg ?? '' };
    const form = buildForm([
      { key: 'length', label: 'Длина, мм', type: 'number', min: 0 },
      { key: 'width', label: 'Ширина, мм', type: 'number', min: 0 },
      { key: 'height', label: 'Высота, мм', type: 'number', min: 0 },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', min: 0 },
    ], initial);
    const save = button({
      label: 'Сохранить в изделие', kind: 'secondary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        const end = busyBtn(save);
        try {
          const { values: v } = form.read();
          if (!v) return;
          const changed = (key) => String(v[key] ?? '') !== String(initial[key]);
          const dimensions = ['length', 'width', 'height'].filter(changed);
          const body = {};
          if (dimensions.length) body.dimensions = {
            ...d, unit: d.unit || 'мм',
            ...Object.fromEntries(dimensions.map((key) => [key, v[key] ?? null])),
          };
          if (changed('weightKg')) body.weightKg = v.weightKg ?? null;
          if (!Object.keys(body).length) { done({ saved: false }); return; }
          await patchProduct(productId, body);
          toast('Габариты и вес записаны в изделие.');
          done({ saved: true });
        } catch (e) { toastError(e, 'сохранить габариты'); }
        finally { end(); }
      },
    });
    const back = protectSide(slot, form.dirty, save, done);
    const aiStatus = h('p', { class: 'hint bk-toc-hint', 'aria-live': 'polite' });
    const d0 = prod.dimensions || {};
    const rowsText = [
      `Длина: ${d0.length || '—'}`, `Ширина: ${d0.width || '—'}`,
      `Высота (над грунтом): ${d0.height || '—'}`, `Вес, кг: ${prod.weightKg || '—'}`,
    ].join('\n');
    const aiBtn = focusAiBtn('dims', {
      productLabel: [prod.article, prod.name].filter(Boolean).join(' — '),
      rowsText,
    }, aiStatus);
    slot.replaceChildren(sidePanel('Габариты и вес',
      h('div', { class: 'bk-ed-row' }, save, back, aiBtn),
      aiStatus,
      form.el,
    ));
  } catch (e) {
    if (!isCurrent()) return;
    toastError(e, 'открыть габариты');
    done({ saved: false });
  }
}


/** Состав изделия — дерево + воронка (C142), без ухода из книжки. */
export async function openCompositionInBook(slot, productId, { onDone } = {}) {
  setSideWide(slot, true, { editing: true });
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю состав…'));
  try {
    const { mountCompositionFunnel } = await import('./book-composition-funnel.js');
    await mountCompositionFunnel(slot, productId, { onDone: (r) => { endEdit(slot); onDone?.(r); } });
  } catch (e) {
    endEdit(slot);
    toastError(e, 'открыть состав');
    slot.replaceChildren(
      h('p', { class: 'hint' }, 'Не удалось открыть состав.'),
      button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => onDone?.({ saved: false }) }),
    );
  }
}
