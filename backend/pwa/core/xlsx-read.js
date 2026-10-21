/**
 * Чтение таблицы из файла в браузере, без библиотек (TASKS МВ.5): .xlsx (zip + XML, распаковка DecompressionStream)
 * или .csv / .txt. Результат — текст «колонки через Tab», дальше тот же разбор, что и у вставки (core/paste-parse.js).
 *   const text = await readTableFile(file)        // первый лист
 *   downloadTemplate()                            // шаблон: Артикул; Наименование; Кол-во; Ед.; Цена; Сумма
 */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Минимальный zip-читатель: центральный каталог → нужные файлы. */
async function unzip(buf, want) {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Это не файл Excel (.xlsx)');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (want(name)) {
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      files[name] = dec.decode(method === 0 ? data : await inflateRaw(data));
    }
    p += 46 + nl + el + cl;
  }
  return files;
}

const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

async function xlsxToText(buf) {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const parse = (s) => new DOMParser().parseFromString(s || '<x/>', 'application/xml');
  const shared = [...parse(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  // первый лист по книге (порядок вкладок), иначе sheet1
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const first = parse(files['xl/workbook.xml']).getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id');
  if (rid) { const rel = [...parse(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid); const tg = rel?.getAttribute('Target'); if (tg) sheetPath = 'xl/' + tg.replace(/^\/?xl\//, ''); }
  const sheet = parse(files[sheetPath] || Object.entries(files).find(([k]) => k.startsWith('xl/worksheets/'))?.[1]);
  const lines = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v;
      cells[colIdx(c.getAttribute('r') || 'A1')] = String(val).replace(/[\t\r\n]+/g, ' ');
    }
    if (cells.some((x) => x && x.trim())) lines.push(Array.from(cells, (x) => x ?? '').join('\t'));
  }
  return lines.join('\n');
}

export async function readTableFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name) || new Uint8Array(buf.slice(0, 2)).join() === '80,75') return xlsxToText(buf);
  if (/\.xls$/i.test(file.name)) throw new Error('Старый формат .xls — сохраните файл как .xlsx (Файл → Сохранить как)');
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
  // CSV: «;» или «,» → Tab (кавычки по краям убираем)
  return text.replace(/^﻿/, '').split(/\r?\n/).map((l) => (l.includes('\t') ? l : l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '').replace(/""/g, '"')).join('\t'))).join('\n');
}

/** Шаблон для заполнения в Excel: CSV с «;» и BOM — Excel открывает как таблицу с русскими буквами. */
export function downloadTemplate(name = 'шаблон-позиций.csv') {
  const rows = ['Артикул;Наименование;Кол-во;Ед.;Цена;Сумма'];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
