import { api, PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { normSearch, searchTokens } from '../../core/facets.js';
import { date } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { createProductFor } from '../products.js';
import { modal } from '../../ui/dialog.js';
import { toastError } from '../../ui/toast.js';
import { LATER_CATS, STATUS_LABEL, V2_CATS, V2_NUMS, api_get, canEdit, dims, num, st } from './common.js';
import { mmOf, models, productsAll, resetProducts } from './models.js';

/** Блок «Изделие» формы нового паспорта и подстановка из изделия. */
/**
 * Блок «Изделие» нового паспорта (ПИ): категория → изделия категории (фото, артикул, «паспортов: N»), поиск — по всем;
 * «+ Создать изделие»; выбор подставляет по порядку: поля изделия → его значения по умолчанию → умолчания категории
 * (wireForm.defaults) → последний паспорт изделия (картинки по видам, тексты). Пока не выбрано — остальное скрыто.
 */
export function productBlock(api, { r, catBy }) {
  const box = api.input('_product')?.el; if (!box) return;
  st.inhCat = null;
  const formEl = api.root; const block = box.closest('.form-block'); block?.classList.add('pp-first');
  const saveBtn = () => [...(api.root.closest('.drawer')?.querySelectorAll('button.btn-primary') || [])].find((b) => /^(Создать|Выпустить|Сохранить)/.test(b.textContent.trim()));
  let chosen = null; let catInfo = null; let filterCat = api.get('passportCategory') || ''; let q = api.get('_searchName') || '';
  const lock = (on) => { formEl.classList.toggle('pp-locked', on); const b = saveBtn(); if (b) { b.disabled = on; b.title = on ? 'Сначала выберите изделие' : ''; let n = b.parentNode.querySelector('.pp-save-hint'); if (on && !n) { n = h('span', { class: 'muted pp-save-hint' }, 'Сначала выберите изделие'); b.after(n); } else if (!on) n?.remove(); } };
  // сводка «из изделия»: поля изделия не показываем полями — одна строка и ссылка «править в изделии» (DESIGN §4 «Сводка из изделия»)
  const sumLine = h('div', { class: 'pp-fromprod' });
  const paintSum = () => {
    if (!chosen) return;
    const cat = V2_CATS.find((c) => c.value === api.get('passportCategory'))?.label;
    const text = [cat, dims({ height: api.get('height'), length: api.get('length'), width: api.get('width') }), api.get('weight') && api.get('weight') + ' кг'].filter(Boolean).join(' · ');
    const note = [];
    paintBadge();
    sumLine.replaceChildren(text ? text + ' — ' : '', 'из изделия · ', h('a', { href: '#products?open=' + chosen.id, target: '_blank', rel: 'noopener', title: 'Откроется в новой вкладке — паспорт здесь останется как есть' }, 'править в изделии'),
      ' · ', h('button', { type: 'button', class: 'link-btn', onclick: () => { api.open('name'); api.field('name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'изменить название паспорта'));
  };
  // источник категории — плашка рядом с выбором «Категория паспорта»
  const badge = h('div', { class: 'pp-cat-src' });
  const paintBadge = () => {
    if (!catInfo || !chosen) { badge.replaceChildren(); return; }
    const cur = api.get('passportCategory'); const base = catInfo.own?.code || catInfo.inherited?.code || '';
    let kind = 'ok'; let text;
    if (cur && base && cur !== base) { kind = 'warn'; text = 'выбрана вручную'; }
    else if (catInfo.own) text = 'задана в изделии';
    else if (catInfo.inherited?.source === 'group') text = `из группы «${catInfo.group}»`;
    else if (catInfo.inherited) { kind = 'warn'; text = catInfo.type ? `по разделу «${catInfo.type}» — проверьте` : 'по разделу — проверьте'; }
    else { kind = 'warn'; text = 'не задана — выберите'; }
    const canReset = catInfo.own && canEdit();
    badge.replaceChildren(h('span', { class: 'badge ' + kind }, 'Категория: ' + text),
      ...(canReset ? [' ', h('button', { type: 'button', class: 'link-btn', onclick: () => resetOwn() }, 'Сбросить')] : []));
  };
  const catField = api.field('passportCategory'); if (catField && !r) catField.append(badge);
  const resetOwn = async () => {
    const grp = catInfo?.group ? `группы «${catInfo.group}»` : 'группы';
    const ok = await modal({ title: 'Сбросить категорию изделия', okText: 'Сбросить', body: h('p', null, `Категория изделия будет браться из ${grp}. Сбросить?`),
      onOk: async () => {
        const d = { ...(catInfo.defaults || {}) }; delete d.passportCategory;
        await api(`/showcase/${chosen.id}/passport-defaults`, { method: 'PUT', body: d });
        return true;
      } }).catch((e) => { toastError(e); return false; });
    if (!ok) return;
    const inh = catInfo?.inherited?.code || '';
    catInfo = { ...catInfo, own: null, defaults: Object.fromEntries(Object.entries(catInfo.defaults || {}).filter(([k]) => k !== 'passportCategory')) };
    st.inhCat = inh;
    if (inh) api.set('passportCategory', inh, { auto: true, src: 'из группы' });
    paintSum();
  };
  formEl.addEventListener('input', paintSum); formEl.addEventListener('change', paintSum);
  const pic = (p) => (p?.photo ? h('img', { class: 'sg-pic', src: PREFIX + (p.photo.thumb || p.photo.url), alt: '' }) : h('div', { class: 'sg-pic sg-pic-none' }));
  const sub = (p) => [p.sku && 'арт. ' + p.sku, [p.type, p.group].filter(Boolean).join(' › '), `паспортов: ${p.passportsCount || 0}`].filter(Boolean).join(' · ');

  async function pick(p, { apply = true } = {}) {
    if (apply && !r && !(await duplicateCheck(p.id, api.get))) return; // НМ-2: дубль — открыть существующий
    chosen = p; api.set('productId', p.id); lock(false); render();
    if (apply) { catInfo = await applyProduct(api, p, catBy); paintSum(); }
  }
  function render() {
    if (r) { // правка: изделие только показываем; без изделия — подсказка (привязать — в карточке)
      paintSum();
      box.replaceChildren(...(chosen ? [h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', null, h('b', null, chosen.name), h('div', { class: 'muted' }, sub(chosen)))), sumLine]
        : [h('p', { class: 'muted' }, 'Паспорт без изделия — «Привязать к изделию» или «Создать изделие из паспорта» в карточке')]));
      return;
    }
    if (chosen) {
      box.replaceChildren(h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', { style: { flex: '1' } }, h('b', null, chosen.name), h('div', { class: 'muted' }, sub(chosen))),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { chosen = null; render(); } }, 'Сменить')), sumLine);
      paintSum();
      return;
    }
    const cats = V2_CATS.filter((c) => c.value && !LATER_CATS.includes(c.value));
    const seg = h('div', { class: 'fseg', role: 'radiogroup', 'aria-label': 'Показать изделия категории' },
      ...[{ value: '', label: 'Все' }, ...cats].map((c) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn' + (filterCat === c.value ? ' on' : ''), 'aria-checked': String(filterCat === c.value),
        onclick: () => { filterCat = c.value; render(); } }, c.label)));
    const input = h('input', { type: 'text', value: q, placeholder: 'Найти изделие: название или артикул — по всем категориям', 'aria-label': 'Найти изделие', autocomplete: 'off' });
    const list = h('ul', { class: 'pp-prod-list', role: 'listbox', 'aria-label': 'Изделия' });
    const add = h('button', { type: 'button', class: 'btn btn-sm' });
    const fill = async () => {
      const all = await productsAll();
      const tk = searchTokens(q);
      let rows = tk.length ? all.filter((p) => { const s = normSearch([p.name, p.sku, p.type, p.group, p.series].filter(Boolean).join(' ')); return tk.every((t) => s.includes(t)); })
        : all.filter((p) => !filterCat || p.ppCategory === filterCat);
      rows = rows.sort((a, b) => (a.canPassport === false) - (b.canPassport === false) || (b.passportsCount || 0) - (a.passportsCount || 0) || String(a.name).localeCompare(String(b.name), 'ru'));
      const shown = rows.slice(0, 60);
      list.replaceChildren(...(shown.length ? shown.map((p) => h('li', { class: 'sg-row sg-pic-row' + (p.canPassport === false ? ' shp-dim' : ''), role: 'option', tabindex: '0', onclick: () => pick(p), onkeydown: (e) => { if (e.key === 'Enter') pick(p); } },
        pic(p), h('div', null, h('div', { class: 'opt-l' }, p.name), h('small', null, sub(p)), p.canPassport === false && (p.missing || []).length ? h('small', { class: 'shp-why' }, (p.missing || []).join('; ')) : null)))
        : [h('li', { class: 'sg-row static' }, h('span', { class: 'muted' }, q ? `По «${q}» изделий нет — создайте его кнопкой ниже` : filterCat ? 'В этой категории изделий пока нет — найдите по названию или создайте' : 'Изделий пока нет — создайте первое'))]),
        ...(rows.length > shown.length ? [h('li', { class: 'sg-row muted static' }, `ещё ${rows.length - shown.length} — уточните поиск`)] : []));
      add.textContent = q ? `+ Создать изделие «${q}»` : '+ Создать изделие';
    };
    let t; input.addEventListener('input', () => { q = input.value; clearTimeout(t); t = setTimeout(fill, 150); });
    add.onclick = () => {
      // форма изделия — в правой панели; после «Создать» вернёмся сюда с выбранным изделием и тем, что уже введено
      const stash = Object.fromEntries(['passportCategory', 'orderNo', 'customerName', 'salesOrderId', 'objectName', 'date', 'supplierOrgId'].map((k) => [k, api.get(k)]).filter(([, v]) => v));
      const code = filterCat || api.get('passportCategory');
      const section = String(catBy.get(code)?.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0] || '';
      createProductFor({ name: q, ...(section ? { type: section } : {}) }, (prod) => {
        resetProducts();
        st.draft = { ...stash, productId: prod.id };
        patch({ of: 'passports', new: '1', open: undefined });
      });
    };
    const noProduct = h('button', { type: 'button', class: 'link-btn', onclick: () => { lock(false); api.open('name'); box.replaceChildren(h('p', { class: 'muted' }, 'Без изделия: начните печатать наименование — возьмите данные из прошлого паспорта.')); setTimeout(() => api.input('name')?.focus?.()); } }, 'Изделия нет в «Продукции» — взять данные из прошлого паспорта');
    box.replaceChildren(h('p', { class: 'hint' }, 'Сначала изделие: выберите — паспорт заполнится из него (серым — подставленное, можно поправить).'),
      seg, h('div', { class: 'pp-prod-tools' }, input, add), list, noProduct);
    fill();
  }

  const pid = api.get('productId');
  if (pid) {
    productsAll().then(async (all) => {
      const p = all.find((x) => x.id === pid) || await api_get(`/showcase/${pid}`).catch(() => null);
      if (p) await pick(p, { apply: !r }); else { lock(!r); render(); }
    });
  } else { lock(!r); render(); }
}

/** Подстановка из изделия (ПИ.3): изделие → passportDefaults → (категория — wireForm) → прошлый паспорт изделия; ручное не трогаем. */
export async function applyProduct(api, p, catBy) {
  const full = await api_get(`/showcase/${p.id}`).catch(() => p);
  const d = full.passportDefaults || {};
  const u = full.dimensions?.unit || 'мм';
  const put = (k, v, src, { onlyEmpty = false } = {}) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    const cur = api.get(k);
    if (api.manual(k) && String(cur ?? '').trim() && cur !== '[]') return;
    if (onlyEmpty && String(cur ?? '').trim() && cur !== '[]' && !api.input(k)?.classList?.contains('is-default')) return;
    api.set(k, Array.isArray(v) ? JSON.stringify(v) : v, { auto: true, src });
  };
  const pc = full.passportCategory || null;
  const own = pc?.own || (d.passportCategory ? { code: d.passportCategory } : null);
  const inherited = pc?.inherited || (pc && !pc.own ? pc : null);
  const ppCat = own?.code || inherited?.code || p.ppCategory || '';
  const srcText = own ? 'из изделия' : inherited?.source === 'group' ? `из группы «${full.group}»` : inherited?.source === 'type' ? `из раздела «${full.type}»` : 'из справочника';
  // 1. поля изделия
  for (const [k, v] of Object.entries({ name: full.name, article: full.sku, category: full.group || full.type, length: mmOf(full.dimensions?.length, u), width: mmOf(full.dimensions?.width, u),
    height: mmOf(full.dimensions?.height, u), weight: full.weightKg ? num(full.weightKg) : '' })) {
    if (k === 'name' && st.keepName && api.get('name') === st.keepName) continue; // название заказчика из позиции заказа не затираем нашим
    put(k, v, 'из изделия');
  }
  if ((full.photos || []).length && !JSON.parse(api.get('img_overview') || '[]').length) api.set('img_overview', full.photos.map((x) => ({ id: x.id, url: x.url, thumb: x.thumb })), { auto: true, src: 'из изделия' });
  // 2. значения паспорта по умолчанию у изделия; категория — первой (за ней wireForm подставит умолчания категории в пустое)
  if (ppCat && !api.manual('passportCategory')) api.set('passportCategory', ppCat, { auto: true, src: srcText });
  for (const k of ['elements', 'materialIds']) put(k, (d[k] || []).map(String), 'из изделия');
  put('installationTypeId', d.installationTypeId ? String(d.installationTypeId) : '', 'из изделия');
  if (d.textChoices && Object.keys(d.textChoices).length) api.set('textChoices', JSON.stringify(d.textChoices), { auto: true, src: 'из изделия' });
  // МИ.4: таблица материалов изделия → таблица паспорта (метки и текст соберутся из неё); правленную вручную не трогаем
  const ms = api.input('_mspec');
  const spec = full.materialsSpec && (full.materialsSpec.rows?.length || full.materialsSpec.coatingIds?.length) ? full.materialsSpec : null;
  if (ms && spec && (ms.isEmpty() || !api.manual('_mspec'))) api.set('_mspec', JSON.stringify(spec), { auto: true, src: 'из изделия' });
  if (typeof d.isKit === 'boolean') put('isKit', d.isKit ? 'yes' : 'no', 'из изделия');
  for (const k of [...V2_NUMS.map(([x]) => x), 'warrantyMonths']) put(k, d[k] !== undefined ? num(d[k]) : '', 'из изделия');
  // 4. последний паспорт этого изделия — запасной: только в пустое; картинки по видам — через _copyFrom (wireForm)
  const last = (await models().catch(() => [])).find((m) => m.productId === p.id);
  if (last) {
    for (const [k, v] of Object.entries(last.values)) if (!['name', 'article', 'passportCategory', '_copyFrom', 'bom', 'purpose', 'installationMethod', 'textChoices', ...(ms && spec ? ['materials', 'materialIds'] : [])].includes(k)) put(k, v, 'из прошлого паспорта', { onlyEmpty: true });
    api.set('_copyFrom', last.values._copyFrom);
  }
  void catBy;
  st.inhCat = inherited?.code || '';
  return { own, inherited, group: full.group, type: full.type, defaults: d };
}
/** НМ-2: перед созданием — черновики того же изделия и выпущенные на тот же заказ / покупателя / адрес. true — создавать дальше. */
export async function duplicateCheck(productId, get) {
  if (!productId) return true;
  const res = await api('/passports/duplicates', { query: { productId, orderNo: get('orderNo') || undefined, customer: get('customerName') || undefined, objectName: get('objectName') || undefined } }).catch(() => ({ items: [] }));
  if (!res.items?.length) return true;
  const list = h('ul', { class: 'timeline' }, ...res.items.map((x) => h('li', null, h('a', { href: `#passports?open=${x.id}` }, x.passportNumber ? `№ ${x.passportNumber}` : 'черновик'), h('span', { class: 'muted' }, ' · ' + [STATUS_LABEL[x.status] || '', x.name, x.customerName, x.orderNo && 'заказ ' + x.orderNo, date(x.date)].filter(Boolean).join(' · ')))));
  const open = await modal({ title: 'На это изделие паспорт уже есть', okText: 'Открыть существующий', cancelText: 'Всё равно создать',
    body: h('div', null, h('p', null, 'Возможно, это дубль:'), list), onOk: async () => res.items[0].id });
  if (open) { patch({ of: undefined, new: undefined, open }); return false; }
  return true;
}
