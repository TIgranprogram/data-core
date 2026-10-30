import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/toast.js';
import { tagPick } from '../../ui/tag-pick.js';
import { photoDrop } from '../../ui/photos.js';
import { rowsTable } from '../../ui/rows-table.js';
import { funnelBox } from '../../ui/funnel.js';
import { imagesBody } from '../../core/passport-images.js';
import { V2_CATS, BOM_COLS, LATER_CATS, canEdit, imgsOf, kinds, dictOpts } from './common.js';
import { checkBlock } from './card-blocks.js';
import { issueAction } from './dialogs.js';

/** Определения шагов мастера. */
const STEPS = [
  { key: 'product',   label: 'Изделие',      done: (r) => !!r.productId },
  { key: 'category',  label: 'Категория',     done: (r) => !!r.passportCategory },
  { key: 'params',    label: 'Размеры и вес', done: (r) => !!(r.height && r.length && r.width) },
  { key: 'materials', label: 'Состав',        done: (r) => !!(r.materialIds?.length > 0 || r.materials) },
  { key: 'photos',    label: 'Фотографии',    done: (r) => (r.images || []).some((i) => i.url) },
  { key: 'bom',       label: 'Комплектность', done: () => false, optional: true },
  { key: 'issue',     label: 'Выпуск',        done: () => false },
];

/** Первый незаполненный шаг (или последний). */
function firstActive(row) {
  const idx = STEPS.findIndex((s) => !s.done(row));
  return idx < 0 ? STEPS.length - 1 : idx;
}

/** Следующий незаполненный шаг после afterIdx. */
function nextUnfilled(row, afterIdx) {
  for (let i = afterIdx + 1; i < STEPS.length; i++) {
    if (!STEPS[i].done(row)) return i;
  }
  return STEPS.length - 1;
}

/** PATCH паспорта + refresh; возвращает свежую запись или null при ошибке. */
async function patchPassport(id, ctx, body) {
  try {
    await api(`/passports/${id}`, { method: 'PATCH', body });
    const fresh = await api(`/passports/${id}`);
    ctx.setRow(fresh);
    return fresh;
  } catch (e) {
    toastError(e);
    return null;
  }
}

/** Быстрое удаление всех дочерних узлов. */
function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Определить шаг мастера по тексту из r.missing. */
function missToStep(m) {
  if (/категори/i.test(m)) return 1;
  if (/высот|длин|ширин/i.test(m)) return 2;
  if (/материал|элемент/i.test(m)) return 3;
  if (/фото|рисунок/i.test(m)) return 4;
  return -1;
}

/* -------- Построители форм шагов -------- */

function buildProductSearch(row, ctx, onSaved) {
  const inp = h('input', { type: 'text', class: 'inp', placeholder: 'Начните вводить название изделия…' });
  const dropList = h('ul', { class: 'pw-suggest' });
  dropList.style.display = 'none';
  let picked = null;
  let searchTimer = null;

  inp.addEventListener('input', () => {
    clearTimeout(searchTimer);
    picked = null;
    const q = inp.value.trim();
    if (q.length < 2) { dropList.style.display = 'none'; return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = await api('/showcase', { query: { search: q, limit: 10 } });
        const items = Array.isArray(res) ? res : (res.items || []);
        clear(dropList);
        items.forEach((p) => {
          const li = h('li', { class: 'pw-suggest-item', onclick: () => {
            picked = p.id;
            inp.value = p.name || String(p.id);
            dropList.style.display = 'none';
          } }, p.name || String(p.id));
          dropList.appendChild(li);
        });
        dropList.style.display = items.length ? '' : 'none';
      } catch { dropList.style.display = 'none'; }
    }, 300);
  });

  inp.addEventListener('blur', () => setTimeout(() => { dropList.style.display = 'none'; }, 200));

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    if (!picked) { toastError(new Error('Выберите изделие из списка')); return; }
    saveBtn.disabled = true;
    const fresh = await patchPassport(row.id, ctx, { productId: picked });
    if (fresh) onSaved(fresh, 0);
    else saveBtn.disabled = false;
  } }, 'Сохранить →');

  return h('div', { style: { position: 'relative' } },
    h('label', { class: 'field wide' }, h('span', null, 'Изделие из «Продукции»'), inp),
    dropList,
    h('div', { class: 'pw-actions' }, saveBtn));
}

function buildProduct(row, ctx, onSaved) {
  if (row.productId) {
    const name = row.name || '(изделие)';
    const search = buildProductSearch(row, ctx, onSaved);
    const wrap = h('div', null,
      h('p', null, h('b', null, name), h('span', { class: 'muted' }, ' — изделие выбрано')),
      canEdit() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => wrap.replaceWith(search) }, 'Изменить') : null);
    return wrap;
  }
  return buildProductSearch(row, ctx, onSaved);
}

function buildCategory(row, ctx, onSaved) {
  let category = row.passportCategory || '';
  let textChoices = row.textChoices || {};
  let funnelWidget = null;

  const segWrap = h('div', { class: 'seg-group' });
  const funnelWrap = h('div', { style: { marginTop: 'var(--s2)' } });

  V2_CATS.filter((c) => !c.value || !LATER_CATS.includes(c.value) || c.value === category).forEach((c) => {
    const btn = h('button', { type: 'button', class: 'seg-btn' + (category === c.value ? ' active' : ''), onclick: () => {
      category = c.value;
      segWrap.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderFunnel();
    } }, c.label);
    segWrap.appendChild(btn);
  });

  function renderFunnel() {
    clear(funnelWrap);
    if (!category) return;
    funnelWidget = funnelBox({ value: JSON.stringify(textChoices), category, canEditText: canEdit() });
    const el = funnelWidget.el || funnelWidget;
    if (el instanceof Element) {
      el.addEventListener('change', () => {
        try { textChoices = JSON.parse(funnelWidget.value || '{}'); } catch { /* ignore */ }
      });
      funnelWrap.appendChild(el);
    }
  }

  if (category) renderFunnel();

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    if (!category) { toastError(new Error('Выберите категорию')); return; }
    saveBtn.disabled = true;
    let tc = textChoices;
    if (funnelWidget) { try { tc = JSON.parse(funnelWidget.value || '{}'); } catch { /* ignore */ } }
    const fresh = await patchPassport(row.id, ctx, { passportCategory: category, textChoices: tc });
    if (fresh) onSaved(fresh, 1);
    else saveBtn.disabled = false;
  } }, 'Сохранить →');

  return h('div', null, segWrap, funnelWrap, h('div', { class: 'pw-actions' }, saveBtn));
}

function buildParams(row, ctx, onSaved) {
  const FIELDS = [
    { key: 'height', label: 'Высота, мм' },
    { key: 'length', label: 'Длина, мм' },
    { key: 'width',  label: 'Ширина, мм' },
    { key: 'weight', label: 'Вес, кг' },
  ];
  const inputs = {};
  const grid = h('div', { class: 'pw-fields' });

  FIELDS.forEach(({ key, label }) => {
    const val = row[key] != null ? String(row[key]).replace('.', ',') : '';
    const inp = h('input', { type: 'number', min: '0', step: 'any', class: 'inp', 'aria-label': label, value: val });
    inputs[key] = inp;
    grid.appendChild(h('label', { class: 'field' }, h('span', null, label), inp));
  });

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    saveBtn.disabled = true;
    const body = {};
    FIELDS.forEach(({ key }) => {
      const v = inputs[key].value.trim().replace(',', '.');
      if (v !== '') body[key] = Number(v);
    });
    const fresh = await patchPassport(row.id, ctx, body);
    if (fresh) onSaved(fresh, 2);
    else saveBtn.disabled = false;
  } }, 'Сохранить →');

  return h('div', null, grid, h('div', { class: 'pw-actions' }, saveBtn));
}

function buildMaterials(row, ctx, onSaved) {
  const container = h('div', null, h('p', { class: 'muted' }, 'Загрузка справочников…'));
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || '[]') || []; } catch { return []; }
  };

  (async () => {
    try {
      const [els, mats] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials')]);
      const elPick = tagPick({ options: els, value: row.elements || [], label: 'Функциональные элементы' });
      const matPick = tagPick({ options: mats, value: row.materialIds || [], label: 'Материалы' });

      const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        saveBtn.disabled = true;
        const elements = parseArr(elPick.value);
        const materialIds = parseArr(matPick.value);
        const fresh = await patchPassport(row.id, ctx, { elements, materialIds });
        if (fresh) onSaved(fresh, 3);
        else saveBtn.disabled = false;
      } }, 'Сохранить →');

      clear(container);
      container.appendChild(h('div', { class: 'field wide' }, h('span', null, 'Функциональные элементы'), elPick.el));
      container.appendChild(h('div', { class: 'field wide', style: { marginTop: 'var(--s2)' } }, h('span', null, 'Материалы'), matPick.el));
      container.appendChild(h('div', { class: 'pw-actions' }, saveBtn));
    } catch {
      clear(container);
      container.appendChild(h('p', { class: 'hint' }, 'Не удалось загрузить справочники.'));
    }
  })();

  return container;
}

function buildPhotos(row, ctx) {
  const req = row.requiredImages || [];
  const photoKinds = kinds(row).filter(([k]) => req.includes(k) || k === 'overview');
  const wrap = h('div', null);

  photoKinds.forEach(([kind, label]) => {
    const list = imgsOf(row, kind);
    const saveImages = async () => {
      try {
        await api(`/passports/${row.id}`, { method: 'PATCH', body: { images: imagesBody(row.images || []) } });
        const fresh = await api(`/passports/${row.id}`);
        ctx.setRow(fresh);
      } catch (e) { toastError(e); }
    };

    const drop = canEdit() ? photoDrop({
      attach: async (photoId) => {
        row.images = [...(row.images || []), { kind, photoId, order: list.length }];
        return row;
      },
      done: () => saveImages(),
    }) : null;

    const reqMark = req.includes(kind) ? h('span', { class: 'req' }, ' *') : null;
    const countNote = list.length ? h('span', { class: 'muted' }, ` · уже: ${list.length}`) : null;

    wrap.appendChild(h('div', { style: { marginBottom: 'var(--s3)' } },
      h('b', null, label, reqMark, countNote),
      drop));
  });

  return wrap;
}

function buildBom(row, ctx, onSaved, onSkip) {
  const widget = rowsTable({ columns: BOM_COLS, rows: row.bom || [], file: 'Шаблон комплектности', example: ['И-1', 'Изделие в сборе', 1, 'шт.', ''] });
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || '[]') || []; } catch { return []; }
  };

  const skipBtn = h('button', { type: 'button', class: 'btn', onclick: () => onSkip() }, 'Пропустить');
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    saveBtn.disabled = true;
    const bom = parseArr(widget.value);
    const fresh = await patchPassport(row.id, ctx, { bom });
    if (fresh) onSaved(fresh, 5);
    else saveBtn.disabled = false;
  } }, 'Сохранить →');

  return h('div', null, widget.el, h('div', { class: 'pw-actions' }, skipBtn, saveBtn));
}

function buildIssue(row, ctx, goToStep) {
  const check = checkBlock(row);
  const missing = row.missing || [];

  if (!missing.length) {
    const issueBtn = h('button', { type: 'button', class: 'btn btn-primary',
      style: { fontSize: '1.1em', padding: 'var(--s2) var(--s4)' },
      onclick: () => issueAction(row, ctx) }, '✓ Выпустить');
    return h('div', null, check, h('div', { class: 'pw-actions', style: { justifyContent: 'center' } }, issueBtn));
  }

  const ul = h('ul', null, ...missing.map((m) => {
    const si = missToStep(m);
    const goBtn = si >= 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goToStep(si) }, '→ заполнить') : null;
    return h('li', null, m, goBtn ? h('span', null, ' ', goBtn) : null);
  }));

  return h('div', null, check, ul);
}

/* -------- Главная функция -------- */

/**
 * Пошаговый мастер заполнения черновика паспорта (PASSPORT-WIZARD).
 * Показывается только для черновиков у пользователей с правом редактирования.
 *   passportWizard(r, ctx) → HTMLElement
 */
export function passportWizard(r, ctx) {
  let row = r;
  let activeIdx = firstActive(r);

  const stepsBar = h('div', { class: 'pw-steps' });
  const body = h('div', { class: 'pw-body' });
  const root = h('div', { class: 'pw-wizard' }, stepsBar, body);

  function goTo(idx) {
    activeIdx = Math.max(0, Math.min(STEPS.length - 1, idx));
    renderBar();
    renderBody();
  }

  /** Вызывается после успешного PATCH каждого шага. */
  function onSaved(fresh, fromStepIdx) {
    row = fresh;
    activeIdx = nextUnfilled(fresh, fromStepIdx);
    renderBar();
    renderBody();
  }

  function renderBar() {
    clear(stepsBar);
    STEPS.forEach((s, i) => {
      const done = s.done(row);
      const isActive = i === activeIdx;
      const attrs = { type: 'button', class: 'pw-step', onclick: () => goTo(i) };
      if (done) attrs['data-done'] = '';
      if (isActive) attrs['data-active'] = '';
      stepsBar.appendChild(h('button', attrs,
        h('span', { class: 'pw-step-num' }, String(i + 1)),
        h('span', null, s.label)));
    });
  }

  function renderBody() {
    clear(body);
    const s = STEPS[activeIdx];
    body.appendChild(h('div', { class: 'pw-step-title' }, `${activeIdx + 1}. ${s.label}`));

    let content = null;
    if (s.key === 'product')   content = buildProduct(row, ctx, onSaved);
    if (s.key === 'category')  content = buildCategory(row, ctx, onSaved);
    if (s.key === 'params')    content = buildParams(row, ctx, onSaved);
    if (s.key === 'materials') content = buildMaterials(row, ctx, onSaved);
    if (s.key === 'photos')    content = buildPhotos(row, ctx);
    if (s.key === 'bom')       content = buildBom(row, ctx, onSaved, () => goTo(6));
    if (s.key === 'issue')     content = buildIssue(row, ctx, goTo);

    if (content) body.appendChild(h('div', { class: 'pw-step-form' }, content));
  }

  renderBar();
  renderBody();
  return root;
}
