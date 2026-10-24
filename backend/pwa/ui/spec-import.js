import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, parseNum, plural, qty } from '../core/format.js';
import { current } from '../core/router.js';
import { readTableFile } from '../core/xlsx-read.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { errText } from './errors.js';
import { enhanceSelect } from './select.js';
import { toast } from './toast.js';

/*
 * Спецификация из Excel → брони под заказ (SK-6b), правая панель: ?of=specimport&new=1&orderId=<заказ>.
 * Файл разбирается в браузере (core/xlsx-read.js) и на сервер не отправляется — уходят только строки.
 * Шаги: файл → просмотр до записи («найдено / не хватает / не найдено», неоднозначное — выбор из вариантов, строку можно отключить)
 * → «Забронировать» (apply) → отчёт в той же панели: что забронировано, что не попало и почему, «Забронировать сколько свободно»,
 * «Скачать отчёт» (Excel). Новые позиции склада не создаются. Заказ в файле, не совпадающий с выбранным, — строка пропускается.
 */
const MAX_ROWS = 500;
const HEAD = [
  ['order', /^заказ/i], ['line', /^поз/i], ['code', /^(код|артикул)/i], ['name', /^(наименование|название|материал)/i],
  ['qty', /^(кол|количество)/i], ['unit', /^(ед|единиц)/i], ['note', /^примеч/i],
];
const TEMPLATE_HEAD = ['Заказ', 'Позиция', 'Код', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const REASON = { notFound: 'не найдено на складе', ambiguous: 'неоднозначно', unit: 'другая единица', badLine: 'позиция заказа не найдена', badQty: 'количество не подходит' };

/** Текст таблицы (колонки через Tab) → строки спецификации. Бросает понятную ошибку; ничего не отправляет. */
export function parseSpec(text) {
  const grid = String(text || '').split('\n').map((l) => l.split('\t').map((c) => c.trim()));
  const hi = grid.findIndex((r) => r.some((c) => HEAD[3][1].test(c)));
  if (hi < 0) throw new Error('Не нашёл колонку «Наименование». Скачайте шаблон и заполните его — колонки: Заказ, Позиция, Код, Наименование, Кол-во, Ед., Примечание.');
  const col = {};
  grid[hi].forEach((c, i) => { for (const [k, re] of HEAD) if (!(k in col) && re.test(c)) { col[k] = i; break; } });
  if (!('qty' in col)) throw new Error('Не нашёл колонку «Кол-во». Скачайте шаблон и заполните его.');
  const rows = []; const bad = [];
  grid.slice(hi + 1).forEach((r, i) => {
    const get = (k) => (k in col ? r[col[k]] || '' : '');
    const fileRow = hi + i + 2; // номер строки в Excel
    if (!r.some((c) => c)) return;
    const row = { fileRow, order: get('order'), line: get('line'), code: get('code'), name: get('name'), qty: parseNum(get('qty')), unit: get('unit'), note: get('note') };
    if (!row.name) { bad.push(`строка ${fileRow}: нет наименования`); return; }
    if (row.qty === undefined || Number.isNaN(row.qty) || !(row.qty > 0)) { bad.push(`строка ${fileRow}: количество «${get('qty')}» — нужно число больше нуля`); return; }
    rows.push(row);
  });
  if (bad.length) throw new Error(`Файл не загружен, ничего не записано. Исправьте: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? ` …и ещё ${bad.length - 5}` : ''}.`);
  if (!rows.length) throw new Error('В файле нет строк с позициями — заполните шаблон.');
  if (rows.length > MAX_ROWS) throw new Error(`В файле ${rows.length} строк, за раз можно не больше ${MAX_ROWS}. Разделите файл.`);
  return rows;
}

function downloadSpecTemplate() {
  downloadXlsx('Шаблон спецификации.xlsx', [TEMPLATE_HEAD, ['552', 2, '', 'Болт мебельный М6×40', 20, 'шт', 'пример — удалите эту строку']], 'Спецификация');
}

async function build() {
  const orderId = current().params.orderId;
  const order = await api('/salesorders/' + orderId);
  const orderNo = String(order.orderNo || '');
  const lineByNo = new Map((order.lines || []).map((l, i) => [String(l.lineNo || i + 1), l]));

  let rows = []; // разобранные строки файла
  let sent = []; // строки, ушедшие в просмотр (индекс = row в ответе сервера)
  let skipped0 = []; // отброшены на клиенте: { r, message }
  let pv = null; // ответ просмотра
  let off = new Set(); // строки, которые человек отключил (по fileRow)
  let pick = new Map(); // fileRow → выбранный вариант для «неоднозначно»
  let prevChoice = '';
  let done = false;
  let applyUid = uid();
  const report = { reserved: [], skipped: [], groupName: '' };

  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', 'aria-label': 'Файл спецификации' });
  const status = h('div', { class: 'muted small spec-status', role: 'status' });
  const result = h('div', { class: 'spec-result' });
  const fileBox = h('div', { class: 'field wide' }, h('span', null, 'Файл спецификации'), fileIn);
  const el = h('div', { class: 'spec' },
    h('p', { class: 'hint' }, 'Колонки: Заказ, Позиция, Код, Наименование, Кол-во, Ед., Примечание. Заказ выбран выше — в файле «Заказ» и «Позиция» нужны, только если позиции разные. Новые позиции склада не создаются.'),
    h('div', { class: 'tp-sel spec-order' }, h('b', { class: 'clip' }, `Заказ № ${orderNo || '—'}${order.customer ? ' · ' + order.customer : ''}`),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: downloadSpecTemplate }, 'Скачать шаблон')),
    fileBox, status, result);

  function busy(on, text) {
    fileBox.classList.toggle('is-busy', on); fileIn.disabled = on;
    status.textContent = text || '';
  }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    pv = null; off = new Set(); pick = new Map(); prevChoice = ''; result.replaceChildren();
    busy(true, 'Разбираю файл…');
    try {
      rows = parseSpec(await readTableFile(f));
      skipped0 = []; sent = [];
      for (const r of rows) {
        const ref = /^(.*?)\s*[-–]\s*(\d+)$/.exec(r.order); // «552-2»
        const whole = norm(r.order) === norm(orderNo); // номер заказа сам с тире («К-12»)
        const ono = ref && !whole ? ref[1] : r.order; const lno = r.line || (ref && !whole ? ref[2] : '');
        if (ono && norm(ono) !== norm(orderNo)) { skipped0.push({ r, message: `В файле заказ «${ono}», а выбран № ${orderNo}` }); continue; }
        if (lno) { const l = lineByNo.get(/^d+$/.test(lno) ? String(Number(lno)) : lno); if (!l) { skipped0.push({ r, message: `В заказе нет позиции ${lno}` }); continue; } r.lineId = l.id; }
        sent.push(r);
      }
      if (!sent.length) throw new Error('Ни одна строка не относится к этому заказу — проверьте колонки «Заказ» и «Позиция».');
      busy(true, `Сопоставляю со складом: ${sent.length} ${plural(sent.length, 'строка', 'строки', 'строк')}…`);
      pv = await api('/stock/spec/preview', { method: 'POST', body: { salesOrderId: orderId, lines: sent.map((r) => ({ ...(r.code ? { code: r.code } : {}), name: r.name, qty: r.qty, ...(r.unit ? { unit: r.unit } : {}), ...(r.lineId ? { salesOrderLineId: r.lineId } : {}) })) } });
      busy(false, '');
      renderPreview();
    } catch (e) { busy(false, ''); result.replaceChildren(h('div', { class: 'form-error' }, errText(e))); fileIn.value = ''; }
  });

  // ---------- просмотр ----------
  const rowOf = (x) => sent[x.row]; // строка файла по ответу сервера
  const lineTag = (r) => (r.lineId ? h('span', { class: 'tag-lite' }, `${orderNo}-${[...lineByNo].find(([, l]) => l.id === r.lineId)?.[0] || ''}`) : null);

  function renderPreview() {
    const c = pv.counts;
    const matchRow = (x, kind) => {
      const r = rowOf(x);
      const on = h('input', { type: 'checkbox', checked: !off.has(r.fileRow), 'aria-label': 'Бронировать строку', onchange: () => { if (on.checked) off.delete(r.fileRow); else off.add(r.fileRow); } });
      const same = norm(x.name) === norm(r.name);
      return h('li', { class: 'spec-row' }, on,
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: r.name }, r.name, lineTag(r)),
          h('small', { class: kind === 'short' ? 'neg' : 'muted' }, [same ? '' : `на складе: ${x.name}`, kind === 'short' ? `нужно ${qty(x.need)}, свободно ${qty(x.free)}, не хватает ${qty(x.shortBy)}` : `свободно ${qty(x.free)}`].filter(Boolean).join(' · '))),
        h('span', { class: 'num nowrap' }, `${qty(r.qty)} ${x.unit || r.unit || ''}`));
    };
    const noRow = (x) => {
      const r = rowOf(x);
      const right = x.reason === 'ambiguous' && x.candidates?.length ? (() => {
        const sel = h('select', { 'aria-label': 'Какая позиция склада' }, h('option', { value: '' }, '— выберите позицию —'), ...x.candidates.map((cd) => h('option', { value: cd.materialId }, cd.name + (cd.article ? ` · ${cd.article}` : '') + (cd.unit ? ` · ${cd.unit}` : ''))));
        sel.value = pick.get(r.fileRow) || '';
        sel.addEventListener('change', () => { if (sel.value) pick.set(r.fileRow, sel.value); else pick.delete(r.fileRow); });
        queueMicrotask(() => enhanceSelect(sel, { force: true }));
        return h('div', { class: 'spec-pick' }, sel);
      })() : null;
      return h('li', { class: 'spec-row spec-row-no' }, h('span'),
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: r.name }, r.name, lineTag(r)), h('small', { class: 'neg' }, `${REASON[x.reason] || ''}: ${x.message || ''}`.replace(/^: /, '')), right),
        h('span', { class: 'num nowrap' }, `${qty(r.qty)} ${r.unit || ''}`));
    };
    const group = (title, list, tone) => (list.length ? h('div', { class: 'spec-group' }, h('div', { class: 'section-title' }, `${title} — ${list.length}`), h('ul', { class: 'spec-list' + (tone ? ' ' + tone : '') }, ...list)) : null);
    const skip0 = skipped0.map((s) => h('li', { class: 'spec-row spec-row-no' }, h('span'), h('div', { class: 'spec-main' }, h('div', { class: 'clip' }, s.r.name), h('small', { class: 'neg' }, s.message)), h('span', { class: 'num nowrap' }, `${qty(s.r.qty)} ${s.r.unit || ''}`)));

    const prev = pv.previous?.length ? h('fieldset', { class: 'spec-prev' },
      h('legend', null, 'По этому заказу уже есть брони из спецификации'),
      h('p', { class: 'muted small' }, pv.previous.map((p) => `${date(p.createdAt)} — ${p.count} ${plural(p.count, 'бронь', 'брони', 'броней')}`).join('; ')),
      ...[['replace', 'Заменить прежние (снять их и поставить новые)'], ['add', 'Добавить к прежним']].map(([v, label]) => {
        const rb = h('input', { type: 'radio', name: 'spec-prev', value: v, checked: prevChoice === v, onchange: () => { prevChoice = v; } });
        return h('label', { class: 'check' }, rb, h('span', null, label));
      })) : null;

    result.replaceChildren(
      h('div', { class: 'spec-counts' }, h('b', null, `Строк в файле: ${rows.length}`), ` · найдено ${c.matched} · не хватает ${c.short} · не найдено ${c.notMatched + skipped0.length}`),
      prev,
      group('Найдено', pv.matched.map((x) => matchRow(x, 'ok'))),
      group('Не хватает свободного', pv.short.map((x) => matchRow(x, 'short')), 'spec-short'),
      group('Не найдено', [...pv.notMatched.map(noRow), ...skip0]),
      pv.short.length ? h('p', { class: 'hint' }, 'Строки «не хватает» при записи попадут в отчёт — оттуда их можно забронировать «сколько свободно».') : null);
  }

  // ---------- запись и отчёт ----------
  const linesToSend = () => {
    const out = [];
    for (const x of [...pv.matched, ...pv.short]) { const r = rowOf(x); if (!off.has(r.fileRow)) out.push({ row: r.fileRow, materialId: x.materialId, qty: r.qty, ...(r.lineId ? { salesOrderLineId: r.lineId } : {}), ...(r.note ? { note: r.note } : {}) }); }
    for (const x of pv.notMatched) { const m = pick.get(rowOf(x).fileRow); if (m) { const r = rowOf(x); out.push({ row: r.fileRow, materialId: m, qty: r.qty, ...(r.lineId ? { salesOrderLineId: r.lineId } : {}), ...(r.note ? { note: r.note } : {}) }); } }
    return out;
  };

  async function save() {
    if (!pv) throw new Error('Сначала выберите файл со спецификацией');
    const lines = linesToSend();
    if (!lines.length) throw new Error('Нечего бронировать: нет подходящих строк или все отключены');
    if (pv.previous?.length && !prevChoice) throw new Error('Выберите, что сделать с прежними бронями из спецификации: заменить или добавить');
    const r = await api('/stock/spec/apply', { method: 'POST', body: { salesOrderId: orderId, lines, replace: prevChoice === 'replace', clientUid: applyUid } });
    applyUid = uid();
    done = true;
    report.groupName = r.groupName || '';
    report.reserved = r.reserved || []; report.skipped = r.skipped || [];
    renderReport(r.repeated);
    toast(r.repeated ? 'Эти брони уже были поставлены' : `Забронировано позиций: ${report.reserved.length}${r.replaced ? `, снято прежних: ${r.replaced}` : ''}`);
    return { stay: true };
  }

  function reportFile() {
    const st = new Map();
    for (const x of report.reserved) for (const fr of x.rows || []) st.set(fr, `Забронировано ${qty(x.qty)} ${x.unit || ''}`.trim());
    for (const x of report.skipped) for (const fr of x.rows || []) st.set(fr, `${x.reserved ? `Забронировано ${qty(x.reserved)}; ` : ''}${x.reason || 'не попало'}`);
    for (const x of pv.notMatched) { const r = rowOf(x); if (!st.has(r.fileRow)) st.set(r.fileRow, x.message || REASON[x.reason] || 'не найдено'); }
    for (const s of skipped0) st.set(s.r.fileRow, s.message);
    const out = [[...TEMPLATE_HEAD, 'Результат']];
    for (const r of rows) out.push([r.order, r.line, r.code, r.name, r.qty, r.unit, r.note, st.get(r.fileRow) || 'не бронировалось (отключено)']);
    downloadXlsx(`Отчёт по спецификации ${orderNo || ''}.xlsx`.replace(/\s+\./, '.'), out, 'Отчёт');
  }

  async function takeFree(btn) {
    const lines = report.skipped.filter((x) => x.free > 0 && !x.reserved).map((x) => ({ row: (x.rows || [])[0], materialId: x.materialId, qty: x.need, ...(x.salesOrderLineId ? { salesOrderLineId: x.salesOrderLineId } : {}) }));
    if (!lines.length) return;
    btn.disabled = true; btn.classList.add('is-busy');
    try {
      const r = await api('/stock/spec/apply', { method: 'POST', body: { salesOrderId: orderId, lines, takeFree: true, clientUid: uid() } });
      const retried = new Set(lines.map((l) => l.materialId + '|' + (l.salesOrderLineId || '')));
      report.skipped = [...report.skipped.filter((x) => !retried.has(x.materialId + '|' + (x.salesOrderLineId || ''))), ...(r.skipped || [])];
      report.reserved = [...report.reserved, ...(r.reserved || [])];
      renderReport();
      toast(`Забронировано сколько свободно: ${(r.reserved || []).length} ${plural((r.reserved || []).length, 'позиция', 'позиции', 'позиций')}`);
      window.dispatchEvent(new CustomEvent('data-changed'));
    } catch (e) { toast(errText(e), { error: true }); btn.disabled = false; btn.classList.remove('is-busy'); }
  }

  function renderReport(repeated) {
    const notIn = [
      ...report.skipped.map((x) => ({ name: x.name, text: `${x.reserved ? `забронировано ${qty(x.reserved)} из ${qty(x.need)}; ` : ''}${x.reason}`, free: x.free > 0 && !x.reserved })),
      ...pv.notMatched.filter((x) => !pick.get(rowOf(x).fileRow)).map((x) => ({ name: rowOf(x).name, text: x.message })),
      ...skipped0.map((s) => ({ name: s.r.name, text: s.message })),
    ];
    const canFree = report.skipped.some((x) => x.free > 0 && !x.reserved);
    const takeBtn = canFree ? h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => takeFree(e.currentTarget) }, 'Забронировать сколько свободно') : null;
    result.replaceChildren(
      h('div', { class: 'spec-counts' }, h('b', null, repeated ? 'Эти брони уже были поставлены' : `Забронировано: ${report.reserved.length} ${plural(report.reserved.length, 'позиция', 'позиции', 'позиций')}`), report.groupName ? ` · «${report.groupName}»` : ''),
      report.reserved.length ? h('div', { class: 'spec-group' }, h('div', { class: 'section-title' }, 'Забронировано'),
        h('ul', { class: 'spec-list' }, ...report.reserved.map((x) => h('li', { class: 'spec-row' }, h('span'), h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name)), h('span', { class: 'num nowrap' }, `${qty(x.qty)} ${x.unit || ''}`))))) : null,
      notIn.length ? h('div', { class: 'spec-group' }, h('div', { class: 'section-title' }, `Не попало — ${notIn.length}`),
        h('ul', { class: 'spec-list' }, ...notIn.map((x) => h('li', { class: 'spec-row spec-row-no' }, h('span'), h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name), h('small', { class: 'neg' }, x.text)), h('span'))))) : null,
      h('div', { class: 'spec-acts' }, takeBtn, h('button', { type: 'button', class: 'btn btn-sm', onclick: reportFile }, 'Скачать отчёт (Excel)')));
  }

  return { el, dirty: () => !!pv && !done, focus: () => fileIn.focus(), read: () => ({ values: { save } }) };
}

export const specImport = {
  id: 'specimport', title: 'Спецификация', newTitle: 'Спецификация из Excel', card: { heading: () => 'Спецификация' }, get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Забронировать', closeAfterCreate: true },
};
