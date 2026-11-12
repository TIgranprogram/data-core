import { clearProductSelection } from './form-state.js';
import { api as requestApi, PREFIX } from '../../core/api.js';
import { sku as kitSku } from '../../ui/kit/index.js';
import { h } from '../../core/dom.js';
import { normSearch, searchTokens } from '../../core/facets.js';
import { date } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { openCard } from '../../ui/kit/card.js';
import { products } from '../products.js';
import { productForm } from '../products/form-fields.js';
import { modal, segmented, button } from '../../ui/kit/index.js';
import { toastError } from '../../ui/kit/toast.js';
import { LATER_CATS, kinds, STATUS_LABEL, V2_CATS, V2_NUMS, api_get, canEdit, dims, num, st } from './common.js';
import { mmOf, models, productsAll, resetProducts } from './models.js';

// Совпадает с непустыми значениями productPatch; отдельные поля экземпляра сюда не входят.
const PRODUCT_DEFAULTS = ['elements', 'materialIds', 'installationTypeId', 'isKit', 'textChoices', 'textOverrides', 'joints',
  'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears', 'warrantyMonths'];
const PRODUCT_FIELDS = ['name', 'article', 'length', 'width', 'height', 'weight', 'purpose', 'installationMethod', 'description', 'materialsSpec', 'materials', 'passportCategory', ...PRODUCT_DEFAULTS];
const FORM_ALIAS = { materialsSpec: '_mspec' };
const present = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** Для нового паспорта ещё нет fromProductFields: вычисляем по полному ответу изделия. */
export function productSourceFields(full, category) {
  const fields = new Set();
  for (const [key, source] of [['name', 'name'], ['article', 'sku'], ['purpose', 'purpose'], ['installationMethod', 'installation'], ['description', 'description'], ['materials', 'materialsText']]) {
    if (String(full[source] ?? '').trim()) fields.add(key);
  }
  for (const key of ['length', 'width', 'height']) if (Number(full.dimensions?.[key]) > 0) fields.add(key);
  if (Number(full.weightKg) > 0) fields.add('weight');
  if (present(full.materialsSpec)) fields.add('materialsSpec');
  for (const key of PRODUCT_DEFAULTS) if (present(full.passportDefaults?.[key])) fields.add(key);
  if (category) fields.add('passportCategory');
  return fields;
}

/** Ровно те поля, которые сервер возьмёт из изделия. Пустые источники и поля экземпляра остаются доступны. */
export function lockProductFields(form, sources, { active, manualText = [] } = {}) {
  for (const key of PRODUCT_FIELDS) {
    const f = form.field(FORM_ALIAS[key] || key); if (!f) continue;
    const manual = ['purpose', 'installationMethod'].includes(key) && manualText.includes(key);
    const locked = !!active && sources.has(key) && !manual;
    f.inert = locked;
    f.classList.toggle('pp-readonly', locked);
    f.title = locked ? 'Из изделия. Изменить — кнопка «Изменить в изделии» выше' : '';
    let source = f.querySelector('[data-product-source]');
    if (locked && !source) { source = h('small', { class: 'hint', 'data-product-source': 'true' }, 'Из изделия · правка кнопкой «Изменить в изделии»'); f.append(source); }
    if (source) { source.hidden = !locked; source.textContent = locked && form.manual(FORM_ALIAS[key] || key) ? 'Ручное значение заменится данными изделия при сохранении. Проверьте «Изменить в изделии».' : 'Из изделия · правка кнопкой «Изменить в изделии»'; }
  }
}

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
  let chosen = null; let catInfo = null; let filterCat = api.get('passportCategory') || ''; let q = api.get('_searchName') || ''; let pickSeq = 0;
  const lock = (on) => { formEl.classList.toggle('pp-locked', on); const b = saveBtn(); if (b) { b.disabled = on; b.title = on ? 'Сначала выберите изделие' : ''; let n = b.parentNode.querySelector('.pp-save-hint'); if (on && !n) { n = h('span', { class: 'muted pp-save-hint' }, 'Сначала выберите изделие'); b.after(n); } else if (!on) n?.remove(); } };
  // сводка «из изделия»: поля изделия не показываем полями — одна строка и ссылка «править в изделии» (DESIGN §4 «Сводка из изделия»)
  const sumLine = h('div', { class: 'pp-fromprod' });
  // ИЗ-1/ИЗ-2: черновик с изделием — поля изделия и категория только для чтения (правка — в изделии); выпущенный не трогаем
  const draft = !r || String(r.status || 'draft') === 'draft';
  const FROM_PRODUCT = ['name', 'article', 'category', 'length', 'width', 'height', 'weight'];
  // расхождение: у сохранённого черновика своё значение отличается от изделия — показываем, молча не перезаписываем
  const diffs = h('div');
  const checkDiff = async (p) => {
    diffs.replaceChildren(); if (!r || !draft || !p) return;
    const full = await api_get("/showcase/" + p.id).catch(() => null); if (!full) return;
    const d = full.passportDefaults || {}; const u = full.dimensions?.unit || 'мм';
    const src = { length: mmOf(full.dimensions?.length, u), width: mmOf(full.dimensions?.width, u), height: mmOf(full.dimensions?.height, u), weight: full.weightKg ? num(full.weightKg) : '',
      warrantyMonths: d.warrantyMonths, ...Object.fromEntries(V2_NUMS.map(([k]) => [k, d[k]])) };
    const label = Object.fromEntries([['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота'], ['weight', 'Вес'], ['warrantyMonths', 'Гарантия'], ...V2_NUMS.map(([k, l]) => [k, l])]);
    for (const [k, v] of Object.entries(src)) {
      const mine = r[k]; if (mine === undefined || mine === null || mine === '' || v === undefined || v === null || v === '') continue;
      if (Number(mine) !== Number(v)) diffs.append(h('div', null, h('span', { class: 'badge warn' }, 'В паспорте другое значение: ' + mine), ' ' + String(label[k] || k).replace(/,.*$/, '') + ' (в изделии ' + v + ')'));
    }
  };
  const lockData = () => {
    // После возврата из изделия catInfo содержит свежий список. На первом открытии сохранённого — список сервера.
    const sources = catInfo?.sourceFields || new Set(r?.fromProductFields || []);
    const manualText = api.get('_manualText') === 'yes' ? ['purpose', 'installationMethod'] : [];
    lockProductFields(api, sources, { active: !!chosen && draft, manualText });
  };
  const summaryState = () => JSON.stringify(['name', 'passportCategory', 'height', 'length', 'width', 'weight', '_manualText'].map((key) => api.get(key)));
  let paintedSummary = '';
  const paintSum = () => {
    if (!chosen) return;
    paintedSummary = summaryState();
    const cat = V2_CATS.find((c) => c.value === api.get('passportCategory'))?.label;
    const text = [cat, dims({ height: api.get('height'), length: api.get('length'), width: api.get('width') }), api.get('weight') && api.get('weight') + ' кг'].filter(Boolean).join(' · ');
    // ПНЗ.1: паспорт из заказа — название как в заказе; видно, откуда оно, и можно взять наше
    const fromOrder = !r && st.keepName && api.get('name') === st.keepName && st.keepName !== chosen.name;
    paintBadge(); lockData();
    const editProduct = button({ label: 'Изменить в изделии', size: 'S', disabled: !canEdit(), onClick: () => {
      let changed = false;
      openCard(products, { id: chosen.id, mode: 'edit', parent: editProduct }, {
        changed: () => { changed = true; },
        close: async () => {
          if (!changed) return;
          try {
            catInfo = await applyProduct(api, chosen, catBy);
            if (r?.id && draft) { const fresh = await api_get(`/passports/${r.id}`); catInfo.sourceFields = new Set(fresh.fromProductFields || []); }
            await checkDiff(chosen); paintSum();
          }
          catch (e) { toastError(e, 'обновить данные изделия'); }
        },
      });
    } });
    editProduct.dataset.editProduct = 'true';
    sumLine.replaceChildren(text ? text + ' — ' : '', 'из изделия · ', editProduct,
      h('div', { class: 'muted' }, [!api.get('height') || !api.get('length') || !api.get('width') ? 'Габариты в изделии заполнены не полностью.' : '', !api.get('weight') ? 'Вес в изделии не заполнен.' : '', 'Поля паспорта ниже можно дополнить. Общие данные и рисунки — в изделии; после правки вернётесь сюда.'].filter(Boolean).join(' ')), diffs,
      draft ? null : ' · ', draft ? null : button({ label: 'изменить название паспорта', kind: 'ghost', size: 'S', onClick: () => { api.open('name'); api.field('name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }),
      !draft && r?.categoryDiffers ? h('div', null, h('span', { class: 'badge warn' }, 'Категория отличается от изделия'), ' ', V2_CATS.find((c) => c.value === (r.productCategory?.code || r.productCategory))?.label || '') : null,
      fromOrder ? h('div', null, 'Название — как в заказе · ', button({ label: 'взять из изделия', kind: 'ghost', size: 'S', onClick: () => { api.set('name', chosen.name); paintSum(); } })) : null);
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
      ...(canReset ? [' ', button({ label: 'Сбросить', kind: 'ghost', size: 'S', onClick: () => resetOwn() })] : []));
  };
  const catField = api.field('passportCategory'); if (catField && !r) catField.append(badge);
  const resetOwn = async () => {
    const grp = catInfo?.group ? `группы «${catInfo.group}»` : 'группы';
    const ok = await modal({ title: 'Сбросить категорию изделия', okText: 'Сбросить', body: h('p', null, `Категория изделия будет браться из ${grp}. Сбросить?`),
      onOk: async () => {
        const d = { ...(catInfo.defaults || {}) }; delete d.passportCategory;
        await requestApi(`/showcase/${chosen.id}/passport-defaults`, { method: 'PUT', body: d });
        return true;
      } }).catch((e) => { toastError(e); return false; });
    if (!ok) return;
    const inh = catInfo?.inherited?.code || '';
    catInfo = { ...catInfo, own: null, defaults: Object.fromEntries(Object.entries(catInfo.defaults || {}).filter(([k]) => k !== 'passportCategory')) };
    catInfo.sourceFields = new Set(catInfo.sourceFields || r?.fromProductFields || []);
    if (inh) catInfo.sourceFields.add('passportCategory'); else catInfo.sourceFields.delete('passportCategory');
    st.inhCat = inh;
    if (inh) api.set('passportCategory', inh, { auto: true, src: 'из группы' });
    paintSum();
  };
  // input уже обновил сводку. Повторный change на blur не должен удалить кнопку между pointerdown и click.
  // Сертификат и другие поля экземпляра в сводке не участвуют: их ввод вообще не меняет её DOM.
  const refreshSummary = () => { if (summaryState() !== paintedSummary) paintSum(); };
  formEl.addEventListener('input', refreshSummary); formEl.addEventListener('change', refreshSummary);
  const pic = (p) => (p?.photo ? h('img', { class: 'sg-pic', src: PREFIX + (p.photo.thumb || p.photo.url), alt: '' }) : h('div', { class: 'sg-pic sg-pic-none' }));
  const front = (p) => (p.sku ? [kitSku(p.sku), ' ', p.name] : p.name);
  const sub = (p) => h('span', null, [[p.type, p.group].filter(Boolean).join(' › '), `паспортов: ${p.passportsCount || 0}`].filter(Boolean).join(' · '));

  async function pick(p, { apply = true } = {}) {
    const my = ++pickSeq;
    if (apply && !r && !(await duplicateCheck(p.id, api.get))) return; // НМ-2: дубль — открыть существующий
    if (my !== pickSeq) return;
    if (apply && !r) for (const k of [...FROM_PRODUCT, ...V2_NUMS.map(([key]) => key), 'passportCategory', 'warrantyMonths', 'installationTypeId', 'elements', 'materialIds', 'joints', 'textChoices', 'isKit', '_copyFrom', '_imgsFrom', '_mspec', ...kinds().map(([key]) => 'img_' + key)]) {
      if (!api.manual(k) && api.input(k)?.classList?.contains('is-default')) api.set(k, '', { auto: true });
    }
    chosen = p; api.set('productId', p.id); lock(!!apply); render(); checkDiff(p);
    if (apply) {
      try { const info = await applyProduct(api, p, catBy, () => my === pickSeq); if (my !== pickSeq) return; catInfo = info; lock(false); paintSum(); }
      catch (e) { toastError(e, 'загрузить данные изделия — выберите изделие повторно'); }
    }
    else if (!Array.isArray(r?.fromProductFields)) { const full = await api_get(`/showcase/${p.id}`); catInfo = { sourceFields: productSourceFields(full, full.passportCategory?.code || full.passportDefaults?.passportCategory) }; paintSum(); }
  }
  function render() {
    if (r) { // правка: изделие только показываем; без изделия — подсказка (привязать — в карточке)
      paintSum();
      box.replaceChildren(...(chosen ? [h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', null, h('b', null, front(chosen)), h('div', { class: 'muted' }, sub(chosen)))), sumLine]
        : [h('p', { class: 'muted' }, 'Паспорт без изделия — «Привязать к изделию» или «Создать изделие из паспорта» в карточке')]));
      return;
    }
    if (chosen) {
      box.replaceChildren(h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', { style: { flex: '1' } }, h('b', null, front(chosen)), h('div', { class: 'muted' }, sub(chosen))),
        button({ label: 'Сменить', size: 'S', onClick: () => { pickSeq++; chosen = null; catInfo = null; clearProductSelection(api); lock(true); lockData(); render(); } })), sumLine);
      paintSum();
      return;
    }
    const cats = V2_CATS.filter((c) => c.value && !LATER_CATS.includes(c.value));
    const seg = segmented({ items: [{ key: '', label: 'Все' }, ...cats].map((c) => ({ key: c.value, label: c.label })), value: filterCat, label: 'Показать изделия категории', onChange: (k) => { filterCat = k; render(); } }).el;
    const input = h('input', { type: 'text', value: q, placeholder: 'Найти изделие: название или артикул — по всем категориям', 'aria-label': 'Найти изделие', autocomplete: 'off' });
    const list = h('ul', { class: 'pp-prod-list', role: 'listbox', 'aria-label': 'Изделия' });
    const add = button({ label: '', size: 'S' });
    const fill = async () => {
      const all = await productsAll();
      const tk = searchTokens(q);
      let rows = tk.length ? all.filter((p) => { const s = normSearch([p.name, p.sku, p.type, p.group, p.series].filter(Boolean).join(' ')); return tk.every((t) => s.includes(t)); })
        : all.filter((p) => !filterCat || p.ppCategory === filterCat);
      rows = rows.sort((a, b) => (a.canPassport === false) - (b.canPassport === false) || (b.passportsCount || 0) - (a.passportsCount || 0) || String(a.name).localeCompare(String(b.name), 'ru'));
      const shown = rows.slice(0, 60);
      list.replaceChildren(...(shown.length ? shown.map((p) => h('li', { class: 'sg-row sg-pic-row' + (p.canPassport === false ? ' shp-dim' : ''), role: 'option', tabindex: '0', 'aria-disabled': p.canPassport === false ? 'true' : null, title: p.canPassport === false ? 'Нет категории паспорта — заполните в «Продукции»' : null, onclick: () => { if (p.canPassport !== false) pick(p); }, onkeydown: (e) => { if (e.key === 'Enter' && p.canPassport !== false) pick(p); } },
        pic(p), h('div', null, h('div', { class: 'opt-l' }, front(p)), h('small', null, sub(p)), p.canPassport === false ? h('small', { class: 'shp-why' }, 'Нет категории паспорта — заполните в «Продукции»') : null)))
        : [h('li', { class: 'sg-row static' }, h('span', { class: 'muted' }, q ? `По «${q}» изделий нет — создайте его кнопкой ниже` : filterCat ? 'В этой категории изделий пока нет — найдите по названию или создайте' : 'Изделий пока нет — создайте первое'))]),
        ...(rows.length > shown.length ? [h('li', { class: 'sg-row muted static' }, `ещё ${rows.length - shown.length} — уточните поиск`)] : []));
      add.textContent = q ? `+ Создать изделие «${q}»` : '+ Создать изделие';
    };
    let t; input.addEventListener('input', () => { q = input.value; clearTimeout(t); t = setTimeout(fill, 150); });
    add.onclick = () => {
      // Родительская форма остаётся в DOM: сохраняются все поля, ручные метки и прокрутка, включая отмену создания.
      const code = filterCat || api.get('passportCategory');
      const section = String(catBy.get(code)?.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0] || '';
      const form = productForm({ usePending: false, onSimilar: (item, parent) => openCard(products, { id: item.id, parent }, { changed: () => resetProducts(), close: () => {} }) }); let created;
      const create = form.create;
      form.create = async (body) => { created = await create(body); return created; };
      form.closeAfterCreate = true;
      openCard({ ...products, newTitle: 'Новое изделие для паспорта', form }, {
        mode: 'create', parent: add,
        initial: { status: 'draft', unit: 'шт', dimUnit: 'мм', name: q, pdCategory: code || '', ...(section ? { type: section } : {}) },
      }, { changed: () => resetProducts(), close: () => { if (created) pick(created); } });
    };
    const noProduct = button({ label: 'Изделия нет в «Продукции» — взять данные из прошлого паспорта', kind: 'ghost', size: 'S', onClick: () => { lock(false); api.open('name'); box.replaceChildren(h('p', { class: 'muted' }, 'Без изделия: начните печатать наименование — возьмите данные из прошлого паспорта.')); setTimeout(() => api.input('name')?.focus?.()); } });
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
export async function applyProduct(api, p, catBy, isCurrent = () => true) {
  const full = await api_get(`/showcase/${p.id}`);
  if (!isCurrent()) return null;
  const d = full.passportDefaults || {};
  const u = full.dimensions?.unit || 'мм';
  const put = (k, v, src, { onlyEmpty = false } = {}) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    const cur = api.get(k);
    if (['purpose', 'installationMethod'].includes(k) && api.get('_manualText') === 'yes' && String(cur ?? '').trim()) return;
    if (api.manual(k)) return;
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
    height: mmOf(full.dimensions?.height, u), weight: full.weightKg ? num(full.weightKg) : '', purpose: full.purpose, installationMethod: full.installation, description: full.description, materials: full.materialsText })) {
    if (k === 'name' && st.keepName && api.get('name') === st.keepName) continue; // название заказчика из позиции заказа не затираем нашим
    put(k, v, 'из изделия');
  }
  if ((full.photos || []).length && !JSON.parse(api.get('img_overview') || '[]').length) api.set('img_overview', full.photos.map((x) => ({ id: x.id, url: x.url, thumb: x.thumb })), { auto: true, src: 'из изделия' });
  // 2. значения паспорта по умолчанию у изделия; категория — первой (за ней wireForm подставит умолчания категории в пустое)
  if (ppCat && !api.manual('passportCategory')) api.set('passportCategory', ppCat, { auto: true, src: srcText });
  for (const k of ['elements', 'materialIds']) put(k, (d[k] || []).map(String), 'из изделия');
  put('installationTypeId', d.installationTypeId ? String(d.installationTypeId) : '', 'из изделия');
  if ((d.joints || []).length) put('joints', d.joints.map(String), 'из изделия');
  if (d.textChoices && Object.keys(d.textChoices).length) put('textChoices', JSON.stringify(d.textChoices), 'из изделия');
  // МИ.4: таблица материалов изделия → таблица паспорта (метки и текст соберутся из неё); правленную вручную не трогаем
  const ms = api.input('_mspec');
  const spec = full.materialsSpec && (full.materialsSpec.rows?.length || full.materialsSpec.coatingIds?.length) ? full.materialsSpec : null;
  if (ms && spec && !api.manual('_mspec')) api.set('_mspec', JSON.stringify(spec), { auto: true, src: 'из изделия' });
  if (typeof d.isKit === 'boolean') put('isKit', d.isKit ? 'yes' : 'no', 'из изделия');
  for (const k of [...V2_NUMS.map(([x]) => x), 'warrantyMonths']) put(k, d[k] !== undefined ? num(d[k]) : '', 'из изделия');
  // 4. последний паспорт этого изделия — запасной: только в пустое; картинки по видам — через _copyFrom (wireForm)
  const last = (await models().catch(() => [])).find((m) => m.productId === p.id);
  if (!isCurrent()) return null;
  if (last) {
    for (const [k, v] of Object.entries(last.values)) if (!['name', 'article', 'passportCategory', '_copyFrom', 'bom', 'purpose', 'installationMethod', 'textChoices', ...(ms && spec ? ['materials', 'materialIds'] : [])].includes(k)) put(k, v, 'из прошлого паспорта', { onlyEmpty: true });
    api.set('_copyFrom', last.values._copyFrom);
  }
  void catBy;
  st.inhCat = inherited?.code || '';
  return { own, inherited, group: full.group, type: full.type, defaults: d, sourceFields: productSourceFields(full, ppCat) };
}
/** НМ-2: перед созданием — черновики того же изделия и выпущенные на тот же заказ / покупателя / адрес. true — создавать дальше. */
export async function duplicateCheck(productId, get) {
  if (!productId) return true;
  const res = await requestApi('/passports/duplicates', { query: { productId, orderNo: get('orderNo') || undefined, customer: get('customerName') || undefined, objectName: get('objectName') || undefined } }).catch(() => ({ items: [] }));
  if (!res.items?.length) return true;
  const list = h('ul', { class: 'timeline' }, ...res.items.map((x) => h('li', null, h('a', { href: `#passports?open=${x.id}` }, x.passportNumber ? `№ ${x.passportNumber}` : 'черновик'), h('span', { class: 'muted' }, ' · ' + [STATUS_LABEL[x.status] || '', x.name, x.customerName, x.orderNo && 'заказ ' + x.orderNo, date(x.date)].filter(Boolean).join(' · ')))));
  const open = await modal({ title: 'На это изделие паспорт уже есть', okText: 'Открыть существующий', cancelText: 'Всё равно создать',
    body: h('div', null, h('p', null, 'Возможно, это дубль:'), list), onOk: async () => res.items[0].id });
  if (open) { patch({ of: undefined, new: undefined, open }); return false; }
  return true;
}
