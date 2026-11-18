/**
 * C141/C143: правка полей изделия в правой колонке книжки — без ухода в карточку.
 * Материалы, части, габариты, монтаж (+ способ и глубина Г), назначение, числа passport-defaults, состав.
 */
import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button, field, select } from '../../ui/kit/index.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { loadMaterialDicts, materialsSpec, fromComposition } from '../products/form-fields.js';
import { fromAnalog } from '../products/tech-analogs.js';
import { patchProduct } from '../products/data.js';
import { dictRows, V2_NUMS } from './common.js';
import { putDefaults } from './funnel/api.js';
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

/** Числовые умолчания паспорта: ключ → подпись (и глубина Г). */
const NUM_LABEL = Object.fromEntries([
  ...V2_NUMS.map(([k, label]) => [k, label]),
  ['seatsCount', 'Количество мест'],
  ['warrantyMonths', 'Гарантия, мес.'],
  ['foundationDepth', 'Глубина Г (от земли до низа опоры), мм'],
]);

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
  setSideWide(slot, false, { editing: true });
}
function endEdit(slot) {
  setSideWide(slot, false, { editing: false });
}

/** Показать редактор materialsSpec в слоте книжки. onDone — после сохранения или «Назад». */
export async function openMaterialsInBook(slot, productId, { focusParts = false, onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю таблицу материалов…'));
  setSideWide(slot, true, { editing: true });
  const done = (r) => { endEdit(slot); onDone?.(r); };
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
        preview: false, // текст уже на листе книжки — в колонке не дублируем
      });
      // secondary: единственная primary в окне — «Выпустить» (C143 UI-REVIEW)
      const save = button({
        label: 'Сохранить в изделие',
        kind: 'secondary',
        size: 'S',
        disabled: !session.canEdit,
        onClick: async () => {
          try {
            const body = { materialsSpec: specW.value ? JSON.parse(specW.value) : null };
            await patchProduct(productId, body);
            prod.materialsSpec = body.materialsSpec;
            toast('Материалы сохранены в изделие — паспорт возьмёт их при следующей сборке текстов.');
            done({ saved: true });
          } catch (e) { toastError(e, 'сохранить материалы'); }
        },
      });
      const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) });
      const aiStatus = h('p', { class: 'hint bk-toc-hint', 'aria-live': 'polite' },
        'Нужны части/материалы с фото: скопируйте промпт → чат ИИ → прикрепите фото.');
      const aiBtn = focusAiBtn(focusParts ? 'parts' : 'materials', () => materialsAiContext(prod, dicts, specW), aiStatus);
      // кнопки сверху слота — всегда в кадре при прокрутке таблицы
      slot.replaceChildren(sidePanel(focusParts ? 'Части у материалов' : 'Материалы изделия',
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
    endEdit(slot);
    toastError(e, 'открыть материалы');
    slot.replaceChildren(h('p', { class: 'hint' }, 'Не удалось загрузить материалы.'),
      button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) }));
  }
}

/** Короткая форма габаритов/веса в слоте книжки. */
export async function openDimsInBook(slot, productId, { onDone } = {}) {
  beginEdit(slot);
  const done = (r) => { endEdit(slot); onDone?.(r); };
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
      label: 'Сохранить в изделие', kind: 'secondary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          const v = form.values;
          await patchProduct(productId, {
            dimensions: { length: +v.length || 0, width: +v.width || 0, height: +v.height || 0, unit: d.unit || 'мм' },
            weightKg: +v.weightKg || 0,
          });
          toast('Габариты и вес записаны в изделие.');
          done({ saved: true });
        } catch (e) { toastError(e, 'сохранить габариты'); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) });
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
    toastError(e, 'открыть габариты');
    done({ saved: false });
  }
}

/** Монтаж: текст изделия + способ установки + глубина Г (passport-defaults). focus — какой блок подсветить. */
export async function openInstallationInBook(slot, productId, { focus = 'text', onDone } = {}) {
  beginEdit(slot);
  const done = (r) => { endEdit(slot); onDone?.(r); };
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const [prod, instRows] = await Promise.all([api(`/showcase/${productId}`), dictRows('passportInstall')]);
    const { buildForm } = await import('../../ui/kit/form.js');
    const pd = prod.passportDefaults || {};
    const form = buildForm(
      [
        { key: 'installation', label: 'Текст монтажа', type: 'textarea', rows: 3, wide: true, max: 1000 },
        { key: 'foundationDepth', label: 'Глубина Г, мм', type: 'number', min: 0, hint: 'От земли до низа опоры. На схеме фундамента — подпись «Глубина Г».' },
      ],
      { installation: prod.installation || '', foundationDepth: pd.foundationDepth ?? '' },
    );
    const instOpts = [['', 'Выберите…'], ...instRows.map((r) => [String(r.id || r._id), r.name || r.title || '—'])];
    let installTypeId = pd.installationTypeId ? String(pd.installationTypeId) : '';
    const typeSel = field('Способ установки', select({
      label: 'Способ установки',
      options: instOpts,
      value: installTypeId,
      disabled: !session.canEdit,
      onChange: (v) => { installTypeId = v; },
    }));
    const save = button({
      label: 'Сохранить в изделие', kind: 'secondary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          const v = form.values;
          const depthRaw = String(v.foundationDepth ?? '').trim();
          const depth = depthRaw === '' ? null : Number(String(depthRaw).replace(',', '.'));
          if (depthRaw && (depth == null || !Number.isFinite(depth) || depth < 0)) {
            toast('Глубина Г — число не меньше нуля', { error: true }); return;
          }
          await patchProduct(productId, { installation: v.installation || '' });
          await putDefaults(prod, {
            installationTypeId: installTypeId || '',
            ...(depth == null ? { foundationDepth: '' } : { foundationDepth: depth }),
          });
          toast('Монтаж, способ и глубина Г записаны в изделие.');
          done({ saved: true });
        } catch (e) { toastError(e, 'сохранить монтаж'); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) });
    const title = focus === 'foundationDepth' ? 'Глубина Г' : (focus === 'installationTypeId' ? 'Способ установки' : 'Монтаж');
    const aiStatus = h('p', { class: 'hint bk-toc-hint', 'aria-live': 'polite' });
    const instName = instRows.find((r) => String(r.id || r._id) === installTypeId)?.name || '—';
    const aiBtn = focusAiBtn('install', {
      productLabel: [prod.article, prod.name].filter(Boolean).join(' — '),
      rowsText: [
        `Текст монтажа: ${prod.installation || '—'}`,
        `Способ установки: ${instName}`,
        `Глубина Г, мм: ${pd.foundationDepth ?? '—'}`,
      ].join('\n'),
    }, aiStatus);
    slot.replaceChildren(sidePanel(title,
      h('div', { class: 'bk-ed-row' }, save, back, aiBtn),
      aiStatus,
      form.el,
      typeSel,
    ));
    if (focus === 'foundationDepth') {
      requestAnimationFrame(() => form.el.querySelector('[name=foundationDepth], input')?.focus?.());
    }
  } catch (e) {
    toastError(e, 'открыть монтаж');
    done({ saved: false });
  }
}

/** Назначение изделия (purpose) — текст для паспорта и техописания. */
export async function openPurposeInBook(slot, productId, { onDone } = {}) {
  beginEdit(slot);
  const done = (r) => { endEdit(slot); onDone?.(r); };
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const prod = await api(`/showcase/${productId}`);
    const { buildForm } = await import('../../ui/kit/form.js');
    const form = buildForm(
      [{ key: 'purpose', label: 'Назначение', type: 'textarea', rows: 3, wide: true, max: 1000 }],
      { purpose: prod.purpose || '' },
    );
    const save = button({
      label: 'Сохранить в изделие', kind: 'secondary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          await patchProduct(productId, { purpose: form.values.purpose || '' });
          toast('Назначение записано в изделие.');
          done({ saved: true });
        } catch (e) { toastError(e, 'сохранить назначение'); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) });
    slot.replaceChildren(sidePanel('Назначение',
      h('div', { class: 'bk-ed-row' }, save, back),
      form.el,
    ));
  } catch (e) {
    toastError(e, 'открыть назначение');
    done({ saved: false });
  }
}

/** Одно числовое поле passport-defaults (глубина Г, возраст, площадка…). */
export async function openDefaultsNumInBook(slot, productId, key, { onDone } = {}) {
  beginEdit(slot);
  const done = (r) => { endEdit(slot); onDone?.(r); };
  const label = NUM_LABEL[key] || key;
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю…'));
  try {
    const prod = await api(`/showcase/${productId}`);
    const { buildForm } = await import('../../ui/kit/form.js');
    const cur = prod.passportDefaults?.[key];
    const form = buildForm(
      [{ key, label, type: 'number', min: 0 }],
      { [key]: cur ?? '' },
    );
    const save = button({
      label: 'Сохранить в изделие', kind: 'secondary', size: 'S', disabled: !session.canEdit,
      onClick: async () => {
        try {
          const raw = String(form.values[key] ?? '').trim();
          const n = raw === '' ? null : Number(String(raw).replace(',', '.'));
          if (raw && (n == null || !Number.isFinite(n) || n < 0)) {
            toast('Введите число не меньше нуля', { error: true }); return;
          }
          await putDefaults(prod, { [key]: n == null ? '' : n });
          toast(`${label}: сохранено в изделие.`);
          done({ saved: true });
        } catch (e) { toastError(e, 'сохранить ' + label); }
      },
    });
    const back = button({ label: 'К подсказкам', kind: 'ghost', size: 'S', onClick: () => done({ saved: false }) });
    slot.replaceChildren(sidePanel(label,
      h('div', { class: 'bk-ed-row' }, save, back),
      form.el,
    ));
  } catch (e) {
    toastError(e, 'открыть ' + label);
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
