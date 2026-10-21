import { api } from '../core/api.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { toast, toastError } from './toast.js';

/*
 * «⇩ Excel» в любом списке (TASKS МВ.5): весь список с текущими фильтрами, поиском и сортировкой — в .xlsx.
 * Колонки — те же, что на экране (денежные — только деньги-ролям, как в списке); значение — `column.export(row)`
 * или текст ячейки; числовые колонки (`num`) пишутся числами, чтобы Excel считал суммы.
 */
const MAX = 10000;
const textOf = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(textOf).join(' ') : v instanceof Node ? v.textContent : String(v));
const asNumber = (s) => {
  const t = String(s).replace(/[\s\u00a0₽]/g, '').replace('−', '-').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : s;
};

export async function exportList({ title, path, columns, query, sort }, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю…'; }
  try {
    const rows = [];
    for (let page = 1; rows.length < MAX; page++) {
      const r = await api(path, { query: { ...query, page, limit: 500, sort } });
      rows.push(...r.items);
      if (!r.items.length || rows.length >= (r.total ?? 0) || r.items.length < (r.limit || 500)) break;
    }
    const cols = columns.filter((c) => c.label && c.export !== false);
    const out = [cols.map((c) => c.label), ...rows.slice(0, MAX).map((row) => cols.map((c) => {
      const v = c.export ? c.export(row) : textOf(c.render ? c.render(row) : row[c.key]).trim();
      return typeof v === 'string' && /\bnum\b|right/.test(c.cls || '') ? asNumber(v) : v;
    }))];
    const day = new Date().toLocaleDateString('ru-RU');
    downloadXlsx(`${title} ${day}.xlsx`, out, title);
    toast(`Выгружено в Excel: ${out.length - 1} строк${rows.length >= MAX ? ' (первые 10 000)' : ''}`);
  } catch (e) { toastError(e); } finally { if (btn) { btn.disabled = false; btn.textContent = '⇩ Excel'; } }
}
