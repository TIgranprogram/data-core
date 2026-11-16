// C134: ссылки в текстах паспорта как в PDF: {tab:ключ} → «табл. N», {fig:вид} → «рис. N» (нет таблицы/рисунка — ссылка выпадает; в поле правки остаётся исходный текст).
import { humanBlanks, imgsOf } from './common.js';

/** Номера таблиц — в порядке документа (passport-pdf-v2-layout): размеры, ТО по периодам, комплектность, 4 журнала. */
export function tableNumbers(t) {
  const no = { specs: 1 };
  let n = 1;
  (t.maintenance || []).filter((m) => m.rows?.length).forEach((m, i) => { n++; no['to:' + m.period] = n; if (i === 0) { no.to = n; no.maintenance = n; } });
  for (const k of ['bom', 'storage', 'faults', 'service', 'repairs']) no[k] = ++n;
  return no;
}

/** Номера рисунков: по первой ссылке в тексте; виды без картинки не нумеруются (как в PDF — ссылка выпадает). */
export function figureNumbers(r, texts) {
  const no = {};
  let n = 0;
  for (const s of texts) for (const m of String(s || '').matchAll(/\{fig:([^}]+)\}/g)) {
    const k = m[1];
    if (no[k] || !(imgsOf(r, k).length || (r.standardImages || []).some((x) => x.kind === k && x.url))) continue;
    no[k] = ++n;
  }
  return no;
}

export const refsOf = (tabs, figs) => (text) => humanBlanks(text)
  .replace(/\{tab:([^}]+)\}/g, (_, k) => (tabs[k] ? 'табл. ' + tabs[k] : ''))
  .replace(/\{fig:([^}]+)\}/g, (_, k) => (figs[k] ? 'рис. ' + figs[k] : ''))
  .replace(/\s+([.,;)])/g, '$1').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ');
