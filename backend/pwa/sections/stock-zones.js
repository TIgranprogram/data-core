import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { stockLookup } from '../core/stock-list.js';
import { attachCombo, tagPick, busyBlock, button, empty, failBlock, confirmDlg, toast, toastError, errText } from '../ui/kit/index.js';

/**
 * «Справочники → Склады» (WAREHOUSE-ZONES): список складов и правая панель (of=stockzone&open=<id> | new=1).
 * Склад = категории + позиции «добавить поштучно» + позиции «исключить поштучно». «Основной» (isDefault) — только чтение:
 * в нём ещё и позиции без категории; удалить и снять отметку нельзя. Данные — /api/stockzones (только admin).
 */
export const ZONES_KEY = 'stockzones';
const PATH = '/stockzones';
const isAdmin = () => session.role === 'admin' || session.user?.isOwner === true;
const refresh = () => window.dispatchEvent(new CustomEvent('data-changed'));
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'ru');

// ─── данные ──────────────────────────────────────────────────────────────────────────────────────
let rows = [];
/** Категории материалов с путём «Труба › Профильная». Подкатегории входят в склад сами — отмечать нужно верхнюю. */
async function loadCats() {
  const r = await api('/categories', { query: { type: 'material' } });
  const all = (Array.isArray(r) ? r : r.items || []).map((c) => ({ id: String(c.id), name: c.name, parentId: c.parentId ? String(c.parentId) : '' }));
  const by = new Map(all.map((c) => [c.id, c]));
  const path = (c) => { const out = []; for (let x = c, n = 0; x && n < 8; x = by.get(x.parentId), n++) out.unshift(x.name); return out.join(' › '); };
  return all.map((c) => ({ value: c.id, label: path(c), sub: c.parentId ? 'подкатегория' : '' })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
/** Названия позиций для сохранённых id (список склада; закрытый или скрытый — «позиция не найдена»). */
async function materialNames() {
  const lk = await stockLookup().catch(() => []);
  return new Map(lk.map((x) => [String(x.materialId || x.id), x.name]));
}
const countText = (z) => [
  z.categoryIds?.length ? `категорий: ${z.categoryIds.length}` : '',
  z.includeMaterialIds?.length ? `добавок: ${z.includeMaterialIds.length}` : '',
  z.excludeMaterialIds?.length ? `исключений: ${z.excludeMaterialIds.length}` : '',
].filter(Boolean).join(' · ') || 'категории не выбраны';

// ─── список в «Справочниках» ─────────────────────────────────────────────────────────────────────
export function mountZones() {
  const list = h('div', null, busyBlock('склады'));
  const el = h('div', null,
    isAdmin() ? h('div', { class: 'toolbar' }, button({ label: '+ Склад', kind: 'primary', onClick: () => patch({ of: 'stockzone', new: '1', open: undefined }) })) : null,
    list);

  async function remove(z, btn) {
    if (!(await confirmDlg(`Удалить склад «${z.name}»?`, 'Позиции останутся на месте; пропадёт только деление. Если склад выбран в ролях — сначала уберите его оттуда.', { okText: 'Удалить', danger: true }))) return;
    btn.disabled = true;
    try { await api(`${PATH}/${z.id}`, { method: 'DELETE' }); toast('Склад удалён'); refresh(); await reload(); }
    catch (e) { btn.disabled = false; toastError(e, 'Удалить склад'); }
  }
  function render() {
    if (!rows.length) { list.replaceChildren(empty({ title: 'Складов пока нет.', hint: 'Нажмите «+ Склад». Пока складов нет, все видят весь склад.' })); return; }
    list.replaceChildren(h('ul', { class: 'dict-list' }, ...rows.map((z) => h('li', { class: 'dict-item' + (isAdmin() ? ' clickable' : ''),
      onclick: isAdmin() ? (e) => { if (!e.target.closest('button')) patch({ of: 'stockzone', open: z.id, new: undefined }); } : null },
      h('div', { class: 'dict-name' }, h('b', { title: z.name }, z.name), z.isDefault ? h('span', { class: 'badge info' }, 'Основной') : null),
      h('div', { class: 'dict-desc muted md-hide' }, countText(z)),
      h('div', { class: 'dict-acts' }, isAdmin() ? [
        button({ label: 'Изменить', kind: 'ghost', size: 'S', onClick: () => patch({ of: 'stockzone', open: z.id, new: undefined }) }),
        z.isDefault ? h('span', { class: 'dict-lock muted', title: 'Основной склад нужен программе — удалить нельзя' }, '🔒 Основной')
          : button({ label: 'Удалить', kind: 'ghost', size: 'S', onClick: (e) => remove(z, e.currentTarget) }),
      ] : null)))));
  }
  async function reload() {
    try { rows = ((await api(PATH)).items || []).map((z) => ({ ...z, id: String(z.id) })).sort(byOrder); render(); }
    catch (e) { list.replaceChildren(failBlock(e, () => reload())); }
  }
  return { el, reload, update: () => {} };
}

// ─── поштучный список: поиск позиции → метка ───────────────────────────────────────────────────
function itemsPick(label, hint, ids, names) {
  const chosen = new Map(ids.map((id) => [String(id), names.get(String(id)) || 'Позиция не найдена в списке склада']));
  const tags = h('div', { class: 'tag-pick' });
  const input = h('input', { type: 'text', placeholder: 'Название или размер', 'aria-label': label, maxlength: 100 });
  const paint = () => tags.replaceChildren(...(chosen.size ? [...chosen].map(([id, name]) => h('button', { type: 'button', class: 'tag active', title: 'Убрать', onclick: () => { chosen.delete(id); paint(); tags.dispatchEvent(new Event('change', { bubbles: true })); } }, name, ' ×'))
    : [h('span', { class: 'muted' }, 'Пока никого')]));
  paint();
  const el = h('div', { class: 'field wide' }, h('span', null, label), h('div', null, input), tags, h('div', { class: 'hint' }, hint));
  stockLookup().then((lk) => attachCombo(input, {
    options: () => lk.map((x) => ({ value: String(x.materialId || x.id), label: x.name, sub: x.categoryName || '' })).filter((o) => !chosen.has(o.value)),
    free: false, empty: () => 'Нет такой позиции на складе',
    onPick: (o) => { chosen.set(o.value, o.label); input.value = ''; paint(); tags.dispatchEvent(new Event('change', { bubbles: true })); },
  })).catch(() => { input.disabled = true; input.placeholder = 'Список позиций не загрузился — обновите страницу'; });
  return { el, ids: () => [...chosen.keys()] };
}

// ─── правая панель ───────────────────────────────────────────────────────────────────────────────
async function zoneForm(r) {
  const [cats, names] = await Promise.all([loadCats(), materialNames()]);
  const name = h('input', { type: 'text', maxlength: 80, value: r.name || '', placeholder: 'Например: Профильная труба' });
  const order = h('input', { type: 'text', inputmode: 'numeric', maxlength: 5, value: r.order ? String(r.order) : '' });
  const catPick = tagPick({ options: cats, value: r.categoryIds || [], label: 'Категории склада' });
  const inc = itemsPick('Добавить позиции поштучно', 'Позиция попадёт в этот склад, даже если её категория не отмечена.', r.includeMaterialIds || [], names);
  const exc = itemsPick('Исключить позиции поштучно', 'Позиция не будет видна на этом складе, даже если её категория отмечена. В обоих списках сразу — нельзя.', r.excludeMaterialIds || [], names);
  const catIds = () => { try { return JSON.parse(catPick.value || '[]'); } catch { return []; } };
  const values = () => ({ name: name.value.trim(), ...(order.value.trim() ? { order: Number(order.value) } : {}), categoryIds: catIds(), includeMaterialIds: inc.ids(), excludeMaterialIds: exc.ids() });
  const start = JSON.stringify(values());
  const el = h('div', { class: 'form-grid' },
    h('p', { class: 'hint wide' }, r.isDefault ? 'Основной склад: в нём ещё и позиции без категории. Назначить другой основной или удалить этот нельзя.' : 'Кладовщик, у роли которого выбран этот склад, видит только его позиции — в списках, поиске, приёмке, выдаче и бронях.'),
    h('label', { class: 'field wide' }, h('span', null, 'Название', h('span', { class: 'req' }, ' *')), name),
    h('label', { class: 'field span-1' }, h('span', null, 'Порядок'), order),
    r.isDefault ? h('div', { class: 'field span-2' }, h('span', null, 'Основной'), h('span', { class: 'muted' }, 'да (только чтение)')) : null,
    h('div', { class: 'field wide' }, h('span', null, 'Категории склада'), catPick.el, h('div', { class: 'hint' }, cats.length ? 'Отметьте категории: подкатегории входят сами. Нужна одна позиция — добавьте её ниже поштучно.' : 'Категорий материалов пока нет.')),
    inc.el, exc.el);
  return {
    el,
    focus: () => name.focus(),
    dirty: () => JSON.stringify(values()) !== start,
    read: () => {
      if (!name.value.trim()) { name.focus(); toast('Впишите название склада', { error: true }); return { errors: { name: 1 } }; }
      if (order.value.trim() && !/^\d{1,5}$/.test(order.value.trim())) { order.focus(); toast('Порядок — целое число, например 2', { error: true }); return { errors: { order: 1 } }; }
      const v = values();
      const both = v.includeMaterialIds.find((id) => v.excludeMaterialIds.includes(id));
      if (both) { toast(`«${names.get(both) || 'Позиция'}» и в добавках, и в исключениях — оставьте в одном списке`, { error: true }); return { errors: { exclude: 1 } }; }
      return { values: v };
    },
  };
}

async function save(id, body) {
  const saved = id ? await api(`${PATH}/${id}`, { method: 'PATCH', body }) : await api(PATH, { method: 'POST', body });
  refresh();
  return { ...saved, id: String(saved.id || id) };
}

export const stockzone = {
  id: 'stockzone',
  title: 'Склад',
  newTitle: 'Новый склад',
  canEdit: isAdmin,
  get: (id) => api(`${PATH}/${id}`).then((z) => ({ ...z, id: String(z.id) })),
  card: {
    heading: (r) => r.name,
    subheading: () => 'Склад (справочник)',
    startEdit: () => true,
    noHistory: true,
    view: (r) => [['Категории', r.categoryIds?.length ? `выбрано: ${r.categoryIds.length}` : 'нет'], ['Добавки', r.includeMaterialIds?.length || null], ['Исключения', r.excludeMaterialIds?.length || null], ['Основной', r.isDefault ? 'да' : null]],
  },
  form: {
    build: (r) => zoneForm(r || {}),
    initial: () => ({}),
    toInitial: (r) => r,
    toBody: (v) => v,
    update: (id, b) => save(id, b).catch((e) => { throw new Error(errText(e)); }),
    create: (b) => save('', b).catch((e) => { throw new Error(errText(e)); }),
  },
};
