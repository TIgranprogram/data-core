import { api } from '../core/api.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { toast, toastError } from './kit/toast.js';
import { button } from './kit/index.js';

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

export async function exportList({ title, path, columns, query, sort, maxRows = MAX }, btn) {
  if (maxRows === Infinity) return exportComplete({ title, path, columns, query, sort }, btn);
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю…'; }
  try {
    const filters = await query;
    const rows = [];
    for (let page = 1; rows.length < MAX; page++) {
      const r = await api(path, { query: { ...filters, page, limit: 500, sort } });
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

/** Полный экспорт: один снимок запроса, последовательные страницы, отмена без частичного файла. */
async function exportComplete({ title, path, columns, query, sort }, btn) {
  let cancelled = false;
  const oldText = btn?.textContent;
  const cancel = button({ label: 'Отменить экспорт', onClick: () => { cancelled = true; cancel.disabled = true; } });
  btn?.after(cancel);
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); btn.textContent = 'Готовлю…'; }
  try {
    const cols = columns.filter(c => c.label && c.export !== false).map(c => ({ ...c }));
    const filters = { ...(query && typeof query.then === 'function' ? await query : query) };
    const output = [cols.map(c => c.label)], seen = new Set();
    let total;
    for (let page = 1; ; page++) {
      if (cancelled) break;
      const result = await api(path, { query: { ...filters, page, limit: 500, sort } });
      if (cancelled) break;
      if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || result.page !== page) throw new Error('Экспорт остановлен: некорректная страница данных. Файл не создан.');
      if (total === undefined) total = result.total;
      if (total !== result.total) throw new Error('Список изменился во время экспорта. Повторите выгрузку; файл не создан.');
      if (total + 1 > 1048576) throw new Error('Список превышает предел строк Excel. Уточните фильтры; файл не создан.');
      for (const row of result.items) {
        const id = String(row.materialId || row.id || '');
        if (!id || seen.has(id)) throw new Error('Экспорт остановлен: повтор или отсутствующий идентификатор. Файл не создан.');
        seen.add(id);
        output.push(cols.map(c => {
          const value = c.export ? c.export(row) : textOf(c.render ? c.render(row) : row[c.key]).trim();
          return typeof value === 'string' && /\bnum\b|right/.test(c.cls || '') ? asNumber(value) : value;
        }));
      }
      if (seen.size > total) throw new Error('Экспорт остановлен: количество данных не соответствует итогу.');
      if (seen.size === total) break;
      const limit = result.limit || 500;
      if (!result.items.length || result.items.length < limit) throw new Error('Экспорт остановлен: неполная страница до конца списка. Файл не создан.');
      if (btn) btn.textContent = `Готовлю: ${seen.size} из ${total}`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cancelled) { toast('Экспорт отменён. Файл не создан.'); return; }
    downloadXlsx(`${title} ${new Date().toLocaleDateString('ru-RU')}.xlsx`, output, title);
    toast(`Выгружено в Excel: ${output.length - 1} строк`);
  } catch (error) { toastError(error); }
  finally { cancel.remove(); if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.textContent = oldText; } }
}
