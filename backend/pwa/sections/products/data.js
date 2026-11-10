import { api } from '../../core/api.js';
import { cachedFetch } from '../../core/cache.js';
import { patch } from '../../core/router.js';
import { V2_NUMS, staffOptions, passportCategoryOptions } from '../passports/common.js';

/*
 * Данные раздела «Продукция» (/api/showcase и соседние): все запросы раздела — здесь, вид их не зовёт напрямую.
 * Кэши на несколько секунд — через cachedFetch (core/cache.js).
 */
export { staffOptions, passportCategoryOptions };

const EMPTY_FV = { sections: [], groups: [], series: [], colors: [], sizes: [], units: [], ral: [] };
/** Подсказки формы (ФИ): один запрос на 30 с — карточка зовёт fields() и ради подписей истории. */
export const formValues = () => cachedFetch('showcase:form-values', 30000, () => api('/showcase/form-values')).catch(() => EMPTY_FV);
/** ФИ2: «Назначение» и «Монтаж» — готовые тексты паспортов (GET /passports/phrases), один запрос в минуту. */
export const phrases = (field) => async () => ((await cachedFetch('passports:phrases', 60000, () => api('/passports/phrases')).catch(() => ({})))[field] || []);
/** Дерево разделов/групп с числами изделий (30 с). */
export const groupsTree = () => cachedFetch('showcase:groups', 30000, () => api('/showcase/groups')).catch(() => []);
/** Дерево без кэша — первая страница «Продукции» (не показывает устаревшие числа после правок). */
export const groupsFresh = () => api('/showcase/groups').catch(() => null);
/** Фасеты для воронки: серии по выбранной группе/статусу/поиску. */
export const facets = (query) => api('/showcase', { query: { facets: 1, limit: 1, ...query } });

// Вкладки «Без цены» / «Архив» — только если в них что-то есть (решение пользователя 2026-11-01).
let statusCounts = null;
export const statusChips = () => {
  if (!statusCounts) {
    statusCounts = {};
    Promise.all(['draft', 'archived'].map((st) => api('/showcase?status=' + st + '&limit=1').then((r) => [st, r.total || 0]).catch(() => [st, 0])))
      .then((rows) => { statusCounts = Object.fromEntries(rows); window.dispatchEvent(new CustomEvent('data-changed')); });
  }
  return [{ value: 'draft', label: 'Без цены', count: statusCounts.draft }, { value: 'archived', label: 'Архив', count: statusCounts.archived }].filter((o) => o.count > 0);
};

export const getProduct = (id) => api(`/showcase/${id}`);
export const patchProduct = (id, body) => api(`/showcase/${id}`, { method: 'PATCH', body });
export const createProduct = (body) => api('/showcase', { method: 'POST', body });
export const removeProduct = (r) => api(`/showcase/${r.id}`, { method: 'DELETE' });
export const restoreProduct = (r) => api(`/showcase/${r.id}/restore`, { method: 'POST' });
export const cloneProduct = (id) => api(`/showcase/${id}/clone`, { method: 'POST' });
export const makeVariant = (id) => api(`/showcase/${id}/variant`, { method: 'POST' });

/** Порядок фото изделия: ids — полный новый список (первое — обложка). Три действия карточки — одно место. */
export const setPhotoOrder = (r, ids) => patchProduct(r.id, { photoIds: ids });
const photoIds = (r) => (r.photos || []).map((p) => p.id);
export const photoAdd = (r, photoId) => setPhotoOrder(r, [...photoIds(r), photoId]);
export const photoMain = (r, photoId) => setPhotoOrder(r, [photoId, ...photoIds(r).filter((x) => x !== photoId)]);
export const photoRemove = (r, photoId) => setPhotoOrder(r, photoIds(r).filter((x) => x !== photoId));

/** Пометка скрипта переноса снята: оставляем только текст без строк «⚠». */
// 2026-11-10: был только patch({}) — карточка не перерисовывалась, пометка оставалась на экране
export const clearNoteWarning = async (r, rest) => { await patchProduct(r.id, { notes: rest }); r.notes = rest || null; window.dispatchEvent(new Event('data-changed')); };

/** МИ.2: предложение таблицы материалов по «Составу изделия». */
export const materialsFromComposition = (r) => api(`/showcase/${r.id}/materials-spec/from-composition`);

/** Артикул занят? Живые и корзина; ответ на то же значение — 10 с из кэша (форма спрашивает на каждый ввод). */
export const skuSearch = (v) => cachedFetch('showcase:sku:' + v, 10000, () => {
  const q = `search=${encodeURIComponent(v)}&limit=20`;
  return Promise.all([api(`/showcase?${q}`), api(`/showcase?${q}&deleted=1`).catch(() => ({ items: [] }))]).then(([live, trash]) => ({ live: live.items || [], trash: trash.items || [] }));
});
/** ПРЖ-4: артикул по номеру группы. Без confirm — проверка и число паспортов; с confirm — присвоить. */
export const assignSku = (id, confirm) => api(`/showcase/${id}/assign-sku`, { method: 'POST', body: confirm ? { confirm: true } : {} });

/** БЗ-9: массовое изменение выбранных изделий и откат. */
export const bulkApply = (ids, set, arrays) => api('/showcase/bulk', { method: 'POST', body: { ids, set, arrays } });
export const bulkRestore = (before) => api('/showcase/bulk/restore', { method: 'POST', body: { items: before } });

/** Паспорт по умолчанию у изделия: категория и выбор текстов воронки (passportDefaults.textChoices). Заменяется целиком — берём известные поля. */
export const PD_KEYS = ['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'joints', 'isKit', 'textOverrides', 'warrantyMonths', ...V2_NUMS.map(([k]) => k)];
const putPd = (id, body) => api(`/showcase/${id}/passport-defaults`, { method: 'PUT', body });
export async function savePd(id, pd) {
  const prev = pd.prev || {};
  const cat = pd.category && (pd.category !== pd.derived || prev.passportCategory) ? pd.category : prev.passportCategory || '';
  const over = pd.over || {};
  const empty = (x) => x === undefined || x === null || x === '' || x === false || (Array.isArray(x) && !x.length);
  const sameOver = Object.entries(over).every(([k, v]) => (empty(v) && empty(prev[k])) || JSON.stringify(v) === JSON.stringify(prev[k]));
  if (sameOver && JSON.stringify(prev.textChoices || {}) === JSON.stringify(pd.choices) && cat === (prev.passportCategory || '')) return;
  const merged = { ...prev, ...over };
  await putPd(id, { ...Object.fromEntries(PD_KEYS.filter((k) => merged[k] !== undefined && merged[k] !== null && merged[k] !== '').map((k) => [k, merged[k]])), ...(cat ? { passportCategory: cat } : {}), textChoices: pd.choices });
}
/** «Сбросить» категорию паспорта у изделия: остальные поля passportDefaults остаются. */
export async function resetPdCategory(r) {
  const pd = r.passportDefaults || {};
  await putPd(r.id, { ...Object.fromEntries(PD_KEYS.filter((k) => k !== 'passportCategory' && pd[k] !== undefined && pd[k] !== null && pd[k] !== '').map((k) => [k, pd[k]])), textChoices: pd.textChoices || {} });
  return getProduct(r.id);
}

/** Последний выпущенный паспорт изделия — печать (иначе — шаблон). */
export const getPassport = (id) => api(`/passports/${id}`);

/**
 * «+ Создать изделие» из «Нового паспорта» (ПИ): форма изделия с готовыми разделом и названием; после «Создать» — then(изделие).
 * Запрос живёт 15 минут.
 */
let pendingCreate = null;
export function createProductFor(initial, then) {
  pendingCreate = { initial, then, at: Date.now() };
  patch({ of: 'products', new: '1', open: undefined });
}
export const pendingProduct = () => (pendingCreate && Date.now() - pendingCreate.at < 15 * 60000 ? pendingCreate : null);
export const takePending = () => { const p = pendingProduct(); pendingCreate = null; return p; };
