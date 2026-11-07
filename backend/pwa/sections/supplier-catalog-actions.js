import { api } from '../core/api.js';
import { qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { openPopMenu } from '../ui/kit/pop-menu.js';
import { button } from '../ui/kit/index.js';
import { stock } from './stock.js';

/**
 * Действия каталога номенклатуры (C036 Ш6): позиция (материал) и предложение поставщика.
 * Позицию правим и удаляем теми же формой и путём, что в «Остатках» (stock.js): форма — панель раздела stock, удаление — stock.remove.
 */
const isMaterial = (r) => r.kind === 'material';
const manual = (a) => !a || String(a).startsWith('manual:');
const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);

/** Правка позиции: та же форма, что в «Остатках» (fill=edit — сразу форма без подсветки поля). */
export const editMaterial = (r) => go('stock', { open: r.materialId, fill: 'edit', new: undefined });

/** Копия позиции: сервер делает «… (копия)», копию открываем на правку. */
export async function copyMaterial(r, ctx) {
  const c = await api(`/materials/${r.materialId}/duplicate`, { method: 'POST', body: {} });
  toast(`Создана копия: ${c.name || 'позиция'}`);
  ctx.changed();
  go('stock', { open: c.id || c._id, fill: 'edit', new: undefined });
}

/** Пароль перед удалением — тот же, что у карточки (ui/confirm-password.js); грузится по действию. */
const withConfirm = async (...a) => (await import('../ui/confirm-password.js')).withConfirm(...a);

/** Удаление позиции: «где используется» → подтверждение → пароль (не админу) → как в «Остатках». */
export async function removeMaterial(r, ctx) {
  const why = stock.remove.blocked({ quantity: r.stockQty, reservedQty: 0 });
  if (why) { toast(why, { error: true }); return; }
  let used = 0;
  try { const w = await api(`/materials/${r.materialId}/where-used`, { query: { limit: 1 } }); used = w.total ?? (w.items || []).length; } catch { /* без списка: удаление всё равно спросит */ }
  const text = stock.remove.text({ name: r.materialName || r.name })
    + (used ? ` Позиция используется в составе: ${qty(used)}. После удаления она пропадёт и оттуда.` : '')
    + (r.kind === 'offer' ? ' Предложения поставщиков останутся без связи.' : '') + ' Можно восстановить из корзины.';
  if (!(await confirmDlg('Удалить позицию?', text, { okText: 'Удалить', danger: true }))) return;
  const done = await withConfirm(async () => { await stock.remove.run({ id: r.materialId }); return true; }, { text: 'Удаление требует вашего пароля.' });
  if (done === null) return;
  toast('Позиция удалена', { undo: async () => {
    try { await withConfirm(() => stock.remove.restore({ id: r.materialId }), { text: 'Восстановление требует вашего пароля.' }); toast('Восстановлено'); ctx.changed(); } catch (e) { toastError(e); }
  } });
  ctx.close(); ctx.changed();
}

/** Копия предложения: новая строка того же поставщика, артикул + « (копия)». */
export async function copyOffer(r, ctx) {
  const article = cut(manual(r.article) ? `${r.name} (копия)` : `${r.article} (копия)`, 100);
  const body = { supplierId: r.supplierId, article, name: r.name, color: r.color || '', unit: r.unit || '', note: r.note || '' };
  if (r.priceHint != null) body.price = r.priceHint;
  if (r.materialId) body.materialId = r.materialId;
  const res = await api('/supply/catalog/items', { method: 'POST', body });
  if (res.errors?.length) throw new Error(res.errors.join('; '));
  toast(`Создана копия предложения: ${article}`);
  ctx.changed();
  patch({ open: undefined, q: article, page: undefined });
}

/** Удаление предложения поставщика (позиция склада остаётся). */
export async function removeOffer(r, ctx) {
  if (!(await confirmDlg('Удалить предложение?', `Убрать «${r.name}» у поставщика «${r.supplierName}»? Позиция склада останется.`, { okText: 'Удалить', danger: true }))) return;
  await api(`/supply/catalog/items/${r.id}`, { method: 'DELETE' });
  toast('Предложение удалено');
  ctx.close(); ctx.changed();
}

/** Действия карточки: позиция (если есть) и/или предложение; опасное — внизу «⋯». */
export function cardActions(r) {
  const mat = !!r.materialId;
  return [
    mat && { label: 'Изменить позицию', primary: isMaterial(r), run: () => editMaterial(r) },
    mat && { label: 'Создать копию позиции', more: true, run: (row, ctx) => copyMaterial(row, ctx) },
    !isMaterial(r) && { label: 'Создать копию предложения', more: true, run: (row, ctx) => copyOffer(row, ctx) },
    !isMaterial(r) && { label: 'Удалить предложение…', more: true, danger: true, run: (row, ctx) => removeOffer(row, ctx) },
    mat && { label: 'Удалить позицию…', more: true, danger: true, run: (row, ctx) => removeMaterial(row, ctx) },
  ];
}

/** «+ Создать» в шапке: позиция номенклатуры (форма «Остатков») или предложение поставщика. */
export function createButton() {
  const b = button({ label: '+ Создать', kind: 'primary', onClick: () => openPopMenu({ anchor: b, side: 'down', groups: [{ items: [
    { label: 'Позиция номенклатуры', onSelect: () => go('stock', { new: '1', open: undefined, fill: undefined }) },
    { label: 'Предложение поставщика', onSelect: () => patch({ new: '1', open: undefined }) },
  ] }] }) });
  return b;
}
