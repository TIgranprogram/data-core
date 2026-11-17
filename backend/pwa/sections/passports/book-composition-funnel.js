/**
 * C142: состав изделия в книжке — дерево + воронка «Добавить» (П-1).
 * Что (модуль/деталь/покупное) → Какую → Сколько. Сырьё в изделие не предлагаем.
 */
import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button, hint, stack, textInput, empty, select, field, confirmDlg } from '../../ui/kit/index.js';
import { funnel } from '../../ui/kit/funnel.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { parseNum } from '../../core/format.js';
import { sidePanel } from './book-shared.js';

const KIND_LABEL = { module: 'Модуль (сборка)', part: 'Деталь', purchased: 'Покупное', product: 'Изделие', material: 'Материал' };

async function loadCatalog(kind) {
  if (kind === 'module') {
    const rows = await api('/modules').catch(() => []);
    const list = Array.isArray(rows) ? rows : (rows.items || []);
    return list.map((m) => ({ id: String(m.id || m._id), label: m.name || m.article || m.sku || 'Без имени', sub: m.article || m.sku || '' }));
  }
  if (kind === 'part') {
    const r = await api('/materials', { query: { materialKind: 'part', limit: 500 } }).catch(() => ({ items: [] }));
    return (r.items || []).map((m) => ({ id: String(m.id || m._id), label: m.name || m.article || 'Без имени', sub: m.article || '' }));
  }
  if (kind === 'purchased') {
    const r = await api('/materials', { query: { withParts: 1, limit: 500 } }).catch(() => ({ items: [] }));
    return (r.items || [])
      .filter((m) => m.materialKind === 'purchased' || m.materialKind === 'fastener' || (!m.materialKind && !m.isProfile))
      .filter((m) => m.materialKind !== 'part' && m.materialKind !== 'raw')
      .map((m) => ({ id: String(m.id || m._id), label: m.name || m.article || 'Без имени', sub: m.article || '' }));
  }
  return [];
}

async function moduleKids(moduleId) {
  try {
    const lines = await api(`/modules/${moduleId}/composition`);
    const arr = Array.isArray(lines) ? lines : (lines.items || lines.composition || []);
    return arr.map((x) => ({
      lineType: x.lineType || 'material',
      name: x.name || x.refName || '(без имени)',
      quantity: Number(x.quantity) || 0,
      unit: x.unit || 'шт',
    }));
  } catch { return []; }
}

/** Поля CRM-строки, которые воронка не редактирует, но PUT не должен затирать (C142 / ARCH-NIGHT). */
const KEEP_LINE = ['overrideDimensions', 'isPurchased', 'sourcePosition', 'sourceCode', 'unitPriceOverride', 'sortOrder', 'unit'];

function toPutLines(rows) {
  return rows.filter((r) => !r.readOnly).map((r) => {
    const base = { ...(r.id ? { id: r.id } : {}), lineType: r.lineType, quantity: parseNum(r.quantity) || 0, notes: r.notes || undefined };
    for (const k of KEEP_LINE) if (r[k] !== undefined && r[k] !== null && r[k] !== '') base[k] = r[k];
    if (r.lineType === 'module') return { ...base, moduleId: r.refId };
    if (r.lineType === 'product') return { ...base, productId: r.refId };
    return { ...base, materialId: r.refId };
  });
}

/**
 * Монтирует редактор состава в slot книжки.
 * @returns {{ focus: Function }}
 */
export async function mountCompositionFunnel(slot, productId, { onDone } = {}) {
  slot.replaceChildren(h('p', { class: 'hint' }, 'Загружаю состав…'));
  slot.closest?.('.bk-side')?.classList.add('is-wide');
  const clearWide = () => slot.closest?.('.bk-side')?.classList.remove('is-wide');

  const prod = await api(`/showcase/${productId}`);
  const rows = (prod.composition || []).map((l) => {
    const row = {
      id: l.id || l._id || '',
      lineType: l.lineType || 'material',
      refId: l.refId || l.moduleId || l.materialId || l.productId,
      name: l.name || '',
      article: l.article || '',
      unit: l.unit || 'шт',
      quantity: String(l.quantity ?? 1),
      notes: l.notes || '',
      readOnly: !['material', 'product', 'module'].includes(l.lineType || 'material'),
      missing: !!l.missing,
      children: l.children || null,
    };
    for (const k of KEEP_LINE) if (l[k] !== undefined && l[k] !== null) row[k] = l[k];
    return row;
  });
  const snapshot = () => JSON.stringify(toPutLines(rows));
  let savedSnap = snapshot();

  let kind = '';
  let pickId = '';
  let qty = '1';
  let catalog = [];
  let funnelUi = null;
  let qtyField = null;
  let kidsCache = new Map();
  const focusQty = () => {
    const input = qtyField?.input;
    if (!input) return;
    input.scrollIntoView({ block: 'nearest' });
    qtyField.focus();
    input.select?.();
  };

  const saveAll = async () => {
    const lines = toPutLines(rows);
    if (lines.some((l) => !(l.quantity > 0))) throw new Error('Укажите количество больше нуля или уберите строку');
    await api(`/showcase/${productId}/composition`, { method: 'PUT', body: { lines, types: ['material', 'product', 'module'] } });
    savedSnap = snapshot();
  };
  const isDirty = () => snapshot() !== savedSnap;
  let leaveAsk = null;
  const confirmLeave = () => {
    if (!isDirty()) return Promise.resolve(true);
    if (!leaveAsk) {
      leaveAsk = confirmDlg('Уйти без сохранения?', 'Правки состава в этой панели пропадут.', { okText: 'Уйти без сохранения', danger: true })
        .finally(() => { leaveAsk = null; });
    }
    return leaveAsk;
  };
  slot._bkLeave = confirmLeave;

  const ensureKids = async (r) => {
    if (r.lineType !== 'module' || r.children) return;
    if (kidsCache.has(r.refId)) { r.children = kidsCache.get(r.refId); return; }
    const kids = await moduleKids(r.refId);
    kidsCache.set(r.refId, kids);
    r.children = kids;
  };

  const tree = h('div', { class: 'bk-comp-tree', 'aria-label': 'Текущий состав' });
  const funnelHost = h('div', { class: 'bk-comp-funnel' });
  const createHost = h('div', { class: 'bk-comp-create' });

  const paintTree = async () => {
    if (!rows.length) {
      tree.replaceChildren(empty({ title: 'Состав пуст', hint: 'Добавьте модуль или деталь воронкой ниже.' }));
      return;
    }
    for (const r of rows) if (r.lineType === 'module') await ensureKids(r);
    const blocks = rows.map((r) => {
      const title = KIND_LABEL[r.lineType] || r.lineType;
      const head = h('div', { class: 'bk-comp-row' },
        h('div', { class: 'bk-comp-name' },
          h('b', null, r.name || r.article || 'Без имени'),
          h('span', { class: 'muted small' }, `${title}${r.article ? ' · ' + r.article : ''}`)),
        h('span', { class: 'bk-comp-qty' }, `${r.quantity} ${r.unit}`),
        session.canEdit && !r.readOnly
          ? button({ label: 'Убрать', kind: 'ghost', size: 'S', title: 'Убрать из состава', onClick: () => { rows.splice(rows.indexOf(r), 1); paintTree(); } })
          : null,
      );
      const nested = (r.children || []).length
        ? h('ul', { class: 'bk-comp-kids' }, ...r.children.map((c) => h('li', null, `${c.name} · ${c.quantity} ${c.unit || 'шт'}`)))
        : (r.lineType === 'module' ? h('p', { class: 'hint' }, 'В модуле пока нет деталей') : null);
      return h('div', { class: 'bk-comp-block' }, head, nested);
    });
    tree.replaceChildren(...blocks);
  };

  const applyFunnel = () => {
    const steps = [
      {
        key: 'kind',
        label: 'Что добавить',
        ask: 'модуль, деталь или покупное',
        value: kind,
        values: [
          { id: 'module', label: 'Модуль (сборка)', count: null },
          { id: 'part', label: 'Деталь', count: null },
          { id: 'purchased', label: 'Покупное', count: null },
        ],
      },
      {
        key: 'pick',
        label: kind === 'module' ? 'Какой модуль' : kind === 'part' ? 'Какая деталь' : 'Что из покупного',
        ask: 'выберите из списка',
        value: pickId,
        skip: !kind,
        values: catalog.map((c) => ({ id: c.id, label: c.label, count: null })),
      },
      {
        key: 'qty',
        label: 'Сколько на одно изделие',
        ask: 'укажите количество',
        value: pickId ? 'done' : '',
        skip: !pickId,
        values: [{ id: 'done', label: `${qty} шт — изменить ниже`, count: null }],
      },
    ];
    if (!funnelUi) {
      funnelUi = funnel({
        steps,
        onChange: async (key, value) => {
          if (key === 'kind') {
            kind = value;
            pickId = '';
            qty = '1';
            catalog = kind ? await loadCatalog(kind) : [];
            createHost.replaceChildren();
            applyFunnel();
            return;
          }
          if (key === 'pick') {
            pickId = value;
            applyFunnel();
            return;
          }
          if (key === 'qty') focusQty();
        },
      });
      funnelHost.replaceChildren(
        h('h4', { class: 'bk-side-h' }, 'Добавить в состав'),
        hint('Сверху вниз: сначала тип, потом запись из наших справочников.'),
        funnelUi.el,
        qtyBox(),
        addBtn(),
        createLinks(),
      );
    } else {
      funnelUi.update({ steps });
      funnelHost.replaceChildren(
        h('h4', { class: 'bk-side-h' }, 'Добавить в состав'),
        hint('Сверху вниз: сначала тип, потом запись из наших справочников.'),
        funnelUi.el,
        qtyBox(),
        addBtn(),
        createLinks(),
      );
    }
  };

  const qtyBox = () => {
    if (!pickId) return h('div');
    const ti = textInput({
      label: 'Количество',
      value: qty,
      short: true,
      onInput: (v) => { qty = v; },
    });
    qtyField = ti;
    return ti.el;
  };

  const readOnlyHint = () => (session.canEdit ? null : hint('Только чтение'));

  const addBtn = () => {
    if (!pickId || !kind) return h('div');
    return h('div', { class: 'bk-ed-row' }, button({
      label: 'В состав',
      kind: 'secondary',
      size: 'S',
      disabled: !session.canEdit,
      title: session.canEdit ? 'Добавить выбранное в состав' : 'Только чтение',
      onClick: async () => {
        const item = catalog.find((c) => c.id === pickId);
        if (!item) return;
        const lineType = kind === 'module' ? 'module' : kind === 'part' ? 'material' : 'material';
        const ex = rows.find((r) => r.lineType === lineType && r.refId === pickId);
        if (ex) {
          ex.quantity = String((parseNum(ex.quantity) || 0) + (parseNum(qty) || 1)).replace('.', ',');
        } else {
          rows.push({
            id: '',
            lineType,
            refId: pickId,
            name: item.label,
            article: item.sub || '',
            unit: 'шт',
            quantity: String(parseNum(qty) || 1).replace('.', ','),
            readOnly: false,
            children: null,
          });
        }
        kind = '';
        pickId = '';
        qty = '1';
        catalog = [];
        funnelUi = null;
        await paintTree();
        applyFunnel();
      },
    }), readOnlyHint());
  };

  const createLinks = () => {
    if (!session.canEdit) return h('div');
    if (kind !== 'module' && kind !== 'part') {
      return hint('Нет нужной записи — выберите тип «Модуль» или «Деталь», затем «Создать».');
    }
    return button({
      label: kind === 'module' ? 'Создать модуль' : 'Создать деталь',
      kind: 'ghost',
      size: 'S',
      onClick: () => { paintCreate(kind); },
    });
  };

  const paintCreate = async (forKind) => {
    createHost.replaceChildren(h('p', { class: 'hint' }, 'Готовлю форму…'));
    let catOpts = [];
    if (forKind === 'module') {
      try {
        const cats = await api('/categories', { query: { type: 'module', limit: 200 } });
        catOpts = (cats.items || cats || []).map((c) => [String(c.id || c._id), c.name || c.fullPath || 'Категория']);
      } catch { catOpts = []; }
    }
    const name = textInput({ label: 'Название', value: '', required: true });
    const art = textInput({ label: 'Обозначение (артикул)', value: '', required: true });
    const catSel = forKind === 'module' && catOpts.length
      ? select({ label: 'Категория модуля', options: catOpts, value: catOpts[0][0] })
      : null;
    createHost.replaceChildren(stack(
      h('h4', { class: 'bk-side-h' }, forKind === 'module' ? 'Новый модуль' : 'Новая деталь'),
      hint('Минимум для состава; полное редактирование — в разделе позже.'),
      name.el,
      art.el,
      catSel ? field('Категория модуля', catSel) : (forKind === 'module' ? hint('Нет категорий типа «модуль» — сначала заведите в справочниках.') : null),
      h('div', { class: 'bk-ed-row' },
        button({
          label: 'Создать и выбрать',
          kind: 'secondary',
          size: 'S',
          disabled: forKind === 'module' && !catSel,
          onClick: async () => {
            try {
              if (!name.value.trim() || !art.value.trim()) { toast('Укажите название и обозначение'); return; }
              const body = forKind === 'module'
                ? { name: name.value.trim(), article: art.value.trim(), categoryId: catSel.value }
                : { name: name.value.trim(), article: art.value.trim(), unit: 'шт', materialKind: 'part' };
              const created = forKind === 'module'
                ? await api('/modules', { method: 'POST', body })
                : await api('/materials', { method: 'POST', body });
              const id = String(created.id || created._id);
              catalog = await loadCatalog(forKind);
              kind = forKind;
              pickId = id;
              createHost.replaceChildren();
              funnelUi = null;
              applyFunnel();
              toast('Создано — укажите количество и нажмите «В состав».');
            } catch (e) { toastError(e, 'создать'); }
          },
        }),
        button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: () => createHost.replaceChildren() }),
      ),
    ));
  };

  const save = button({
    label: 'Сохранить состав',
    kind: 'primary',
    size: 'S',
    disabled: !session.canEdit,
    onClick: async () => {
      try {
        await saveAll();
        slot._bkLeave = null;
        toast('Состав сохранён.');
        clearWide();
        onDone?.({ saved: true });
      } catch (e) { toastError(e, 'сохранить состав'); }
    },
  });
  const back = button({
    label: 'К подсказкам',
    kind: 'ghost',
    size: 'S',
    onClick: async () => {
      if (!(await confirmLeave())) return;
      slot._bkLeave = null;
      clearWide();
      onDone?.({ saved: false });
    },
  });

  await paintTree();
  applyFunnel();
  slot.replaceChildren(
    sidePanel('Состав изделия',
      hint('Дерево: модуль → его детали. Добавление — воронкой ниже.'),
      tree,
      funnelHost,
      createHost,
      h('div', { class: 'bk-ed-row' }, save, readOnlyHint(), back),
    ),
  );

  return { focus: () => {} };
}
