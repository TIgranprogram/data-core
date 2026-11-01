import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/toast.js';
import { link } from '../../ui/kit/index.js';
import { go } from '../../core/router.js';
import { rowsTable } from '../../ui/rows-table.js';
import { BOM_COLS, canEdit } from './common.js';
import { checkBlock } from './card-blocks.js';
import { issueAction } from './dialogs.js';

/** Определения шагов мастера. */
const STEPS = [
  { key: 'product',   label: 'Изделие',      done: (r) => !!r.productId },
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
  if (/высот|длин|ширин/i.test(m)) return 1;
  if (/материал|элемент/i.test(m)) return 2;
  if (/фото|рисунок/i.test(m)) return 3;
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
          const bad = p.canPassport === false;
          const li = h('li', { class: 'pw-suggest-item' + (bad ? ' shp-dim' : ''), 'aria-disabled': bad ? 'true' : null, title: bad ? 'Нет категории паспорта — заполните в «Продукции»' : null, onclick: () => {
            if (bad) return;
            picked = p.id;
            inp.value = p.name || String(p.id);
            dropList.style.display = 'none';
          } }, p.name || String(p.id), bad ? h('small', { class: 'shp-why' }, ' Нет категории паспорта — заполните в «Продукции»') : null);
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

/** Ссылка «Изменить в изделии →» (поля модели живут в изделии, не в паспорте). */
const toProduct = (row, label = 'Изменить в изделии →') => (row.productId
  ? link({ label, onClick: () => go('products', { open: row.productId }) })
  : h('span', { class: 'muted' }, 'Сначала выберите изделие'));
const kv = (rows) => h('dl', { class: 'kv-grid' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || h('span', { class: 'muted' }, 'нет'))]));
const num = (v) => (v != null && v !== '' ? String(v).replace('.', ',') : '');

function buildParams(row) {
  return h('div', null,
    kv([
      ['Категория паспорта', row.passportCategory],
      ['Длина (L), мм', num(row.length)], ['Ширина (B), мм', num(row.width)], ['Высота (H), мм', num(row.height)],
      ['Вес, кг', num(row.weight)], ['Ширина посадки, мм', num(row.seatWidth)], ['Высота посадки, мм', num(row.seatHeight)],
      ['Количество опор, шт', num(row.supports)], ['Объём перевозки, куб. м', num(row.shipVolume)],
    ]),
    h('div', { class: 'pw-actions' }, toProduct(row)));
}

function buildMaterials(row) {
  return h('div', null,
    kv([['Материалы', row.materials], ['Описание', row.description], ['Способ установки', row.installationMethod], ['Срок службы, лет', num(row.serviceLifeYears)]]),
    h('div', { class: 'pw-actions' }, toProduct(row)));
}

function buildPhotos(row) {
  const have = (row.images || []).filter((i) => i.url).length;
  return h('div', null,
    h('p', null, 'Рисунки берутся из изделия → «Фото и файлы».', have ? h('span', { class: 'muted' }, ` Сейчас: ${have} шт.`) : null),
    h('div', { class: 'pw-actions' }, toProduct(row, 'Открыть изделие → Фото и файлы →')));
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
    if (fresh) onSaved(fresh, 4);
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
    if (s.key === 'params')    content = buildParams(row, ctx, onSaved);
    if (s.key === 'materials') content = buildMaterials(row, ctx, onSaved);
    if (s.key === 'photos')    content = buildPhotos(row, ctx);
    if (s.key === 'bom')       content = buildBom(row, ctx, onSaved, () => goTo(5));
    if (s.key === 'issue')     content = buildIssue(row, ctx, goTo);

    if (content) body.appendChild(h('div', { class: 'pw-step-form' }, content));
  }

  renderBar();
  renderBody();
  return root;
}
