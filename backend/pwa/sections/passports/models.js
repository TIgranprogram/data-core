import { api, PREFIX } from '../../core/api.js';
import { normSearch } from '../../core/facets.js';
import { ordersLookup } from '../../core/orders-lookup.js';
import { date } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { V2_CATS, V2_NUMS, bomRows, dims, num, plural, st } from './common.js';

/** Модели, готовые тексты, заказы и изизделия для выбора в паспорте; «Выпустить паспорт» из изделия / заказа. */
/** Модели для «выберите модель» (GET /passports/models: артикул + наименование, поля и фото последнего паспорта), кэш на минуту. */
let modelsCache = null; let modelsAt = 0;
export async function models() {
  if (modelsCache && Date.now() - modelsAt < 60000) return modelsCache;
  const items = await api('/passports/models');
  modelsCache = items.map((r) => ({
    productId: r.productId || null, canPassport: r.canPassport !== false, missing: r.missing || [],
    label: r.name, cat: r.category || '', pic: r.thumb ? PREFIX + r.thumb : null,
    sub: [r.passportCategory && (V2_CATS.find((c) => c.value === r.passportCategory)?.label || r.passportCategory), r.article && 'арт. ' + r.article, dims(r), r.weight && num(r.weight) + ' кг', `${r.n} ${plural(r.n, 'паспорт', 'паспорта', 'паспортов')}`, (r.images || []).length ? `картинок ${(r.images || []).length}` : 'без картинок'].filter(Boolean).join(' · '),
    // поиск модели (Э5a5): название, артикул, категория каталога, категория паспорта v2
    search: normSearch([r.name, r.article, r.category, r.passportCategory, V2_CATS.find((c) => c.value === r.passportCategory)?.label].filter(Boolean).join(' ')),
    values: { _copyFrom: r.id, name: r.name, category: r.category || '', article: r.article || '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight),
      materials: r.materials || '', installationMethod: r.installationMethod || '', purpose: r.purpose || '', description: r.description || '', supplierOrgId: r.supplierOrgId || '', warrantyMonths: num(r.warrantyMonths ?? 12),
      bom: JSON.stringify(bomRows(r.bom)),
      ...(r.passportCategory ? { passportCategory: r.passportCategory, elements: JSON.stringify((r.elements || []).map(String)), materialIds: JSON.stringify((r.materialIds || []).map(String)),
        installationTypeId: r.installationTypeId ? String(r.installationTypeId) : '', isKit: r.isKit ? 'yes' : 'no', ...Object.fromEntries(V2_NUMS.map(([k]) => [k, num(r[k])])) } : {}) },
  }));
  modelsCache.sort((a, b) => (a.canPassport === false) - (b.canPassport === false));
  modelsAt = Date.now();
  return modelsCache;
}

/** Готовые тексты «Описания» (GET /passports/phrases) — один запрос на форму. */
let phrasesP = null; let phrasesAt = 0;
export const phrases = (field) => async () => {
  if (!phrasesP || Date.now() - phrasesAt > 60000) { phrasesP = api('/passports/phrases'); phrasesAt = Date.now(); }
  // ПК: варианты — по категории паспорта; фраза про детское у недетских категорий не предлагается
  return ((await phrasesP)[field] || []).map((x) => ({ ...x, categories: CHILD_TEXT.test(x.text) ? (x.passportCategories || []).filter((c) => CHILD_CATS.includes(c)) : x.passportCategories || [] }));
};
export const CHILD_TEXT = /детск|ребён|игров/i;
export const CHILD_CATS = ['DIO', 'DSP'];

/** Заказы для «№ заказа»: выбор подставляет и заказчика. */
export async function orders() {
  const items = await ordersLookup({ filter: 'all' }).catch(() => []); // SK-8d: короткий список, открыт и для «Паспортов»
  return items.filter((o) => o.orderNo).map((o) => ({ label: `№ ${o.orderNo}${o.customer ? ' · ' + o.customer : ''}`, sub: [o.title, o.shipDate && 'отгрузка ' + date(o.shipDate)].filter(Boolean).join(' · '),
    cat: '', search: normSearch([o.orderNo, o.customer, o.title].filter(Boolean).join(' ')), values: { orderNo: o.orderNo, customerName: o.customer || '', salesOrderId: o.id } }));
}
/**
 * «Выпустить паспорт» из изделия или позиции заказа (БЗ-5): открывает «Новый паспорт» в правой панели. Модель ищется
 * по ссылке на изделие, затем по артикулу, затем по названию — подставляются её поля и картинки; номер и талон — сервер.
 * Возвращает true, если модель нашлась.
 */
export async function issuePassport({ productId, name, article, orderNo, salesOrderId, customerName, customerTitle, incomeId }) {
  // ПИ: изделие — единый источник; форма сама подставит его поля, значения по умолчанию, категорию и прошлый паспорт
  let pid = productId;
  if (!pid && (article || name)) {
    const n = (s) => normSearch(s || '');
    const all = await productsAll();
    pid = (article && all.find((p) => n(p.sku) === n(article)))?.id || (name && all.find((p) => n(p.name) === n(name)))?.id || null;
  }
  // ПРЖ-4: из позиции заказа в паспорт идёт название заказчика (правится); из изделия — наше. Выпущенные не меняются.
  st.keepName = customerTitle || '';
  st.draft = { productId: pid || '', salesOrderId, ...(incomeId ? { incomeId } : {}), orderNo, customerName, ...(customerTitle ? { name: customerTitle } : {}), ...(pid ? {} : { _searchName: name || article || '' }) };
  patch({ of: 'passports', new: '1', open: undefined });
  return !!pid;
}

/** ТЭ-6: категория по названию изделия — первое совпадение по порядку (правило из docs/PASSPORT-TEXTS-ETALON.xlsx, лист «Правило категорий»). */
export const NAME_RULES = [
  ['DIO', /качел|карусел|горк|песочн|игров|домик|балансир|качалк|геопласт|детск|бизиборд|пузыр|муравейник|тоннел|пен[её]к|лабиринт/],
  ['TRN', /тренаж/],
  ['WRK', /воркаут|workout|турник|брусь|рукоход|шведск|стенк|скамья для пресса|скамья гимнаст|скамья горизонт|баскет|волейб|футбол|ворот|боксер|ринг|помост|препятств|элемент «|судейск|набивани|кольц/],
  ['BLG', /скам(ья|ейк)|урн|навес|пергол|беседк|вазон|цветоч|огражд|оградит|стенд|стел|\bстол\b|диван|лавк|велопарк|фонар|флагшток|столб|клумб/],
];
export const categoryByName = (name) => { const n = String(name || '').toLowerCase().replace(/ё/g, 'е'); return NAME_RULES.find(([, rx]) => rx.test(n))?.[0] || ''; };

/** Изделия «Продукции» для выбора в паспорте (ПИ): категория паспорта, число паспортов, фото — один запрос в минуту. */
let prodCache = null; let prodAt = 0;
export const productsAll = async () => {
  if (!prodCache || Date.now() - prodAt > 60000) { prodAt = Date.now(); prodCache = api('/showcase', { query: { limit: 500 } }).then((r) => r.items || []).catch(() => { prodCache = null; return []; }); }
  return prodCache;
};
export const mmOf = (v, unit) => { const n = Number(v); return n > 0 ? num(Math.round(n * (unit === 'м' ? 1000 : unit === 'см' ? 10 : 1))) : ''; };
/** Поля паспорта, которые помнит изделие (passportDefaults) — флажок «Запомнить» (ПИ.4). */
export const DEFAULT_KEYS = ['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', 'textChoices', ...V2_NUMS.map(([k]) => k), 'warrantyMonths'];

export const resetProducts = () => { prodCache = null; };
