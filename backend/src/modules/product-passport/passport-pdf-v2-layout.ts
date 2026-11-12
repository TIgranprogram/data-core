import { warranty } from './passport-pdf';
import { PdfV2Input } from './passport-pdf-v2-types';
import { substituteRefs, PlannedFig, planFigures, maintenanceColumns } from './passport-pdf-v2-refs';
import { A5, M, CW, BOTTOM, BODY, Draw, Cell, V2Page, has, num, lines } from './passport-pdf-v2-common';
import { shortPage, cover } from './passport-pdf-v2-cover';
import { isBatch } from './passport-rules';
import { planNumbers } from './passport-numbering';

/** Таблица размеров (ПЧ-4): буквы как на чертеже, объём считается из габаритов. Выпущенный без новых полей печатается как был выпущен. */
export function specRows(p: PdfV2Input['passport']): [string, unknown][] {
  // Партия: размеры каждого изделия — в таблице «Комплектность», здесь толщина и масса партии
  if (isBatch(p)) return [['Длина и ширина, мм', 'по таблице «Комплектность»'], ['Высота (толщина), мм', p.height], ['Масса партии, кг', p.weight]];
  const added = [p.seatWidth, p.seatHeight, p.supports, p.shipVolume].some(has);
  if (p.status !== 'draft' && !added) return [['Высота, мм', p.height], ['Длина, мм', p.length], ['Ширина, мм', p.width], ['Масса, кг', p.weight]];
  const volume = p.shipVolume ?? (p.length && p.width && p.height ? Math.round((p.length * p.width * p.height) / 1e7) / 100 : undefined);
  return [['Длина (L), мм', p.length], ['Ширина (B), мм', p.width], ['Высота (H), мм', p.height], ['Ширина посадки (Bп), мм', p.seatWidth], ['Высота посадки (Hп), мм', p.seatHeight],
    ['Количество опор, шт', p.supports], ['Объём перевозки (V), куб. м', volume], ['Масса, кг', p.weight]];
}

export function layoutV2(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string): V2Page[] {
  const { passport: p, text: t, images } = input;
  const pb = input.look?.pageBox;
  const L = pb ? pb.l : M.l;
  const T = pb ? pb.t : M.t;
  const Btm = pb ? A5.h - pb.b : BOTTOM;
  const Wd = pb ? A5.w - pb.l - pb.r : CW;
  const sections = (t.sections || []).filter((s) => s.items?.length || s.title);
  const maintenance = (t.maintenance || []).filter((m) => m.rows?.length);
  const installLines = lines(t.install?.text);
  const requirements = (t.install?.requirements || []).map((x) => String(x).trim()).filter(Boolean);
  const rules = (t.rules || []).map((x) => String(x).trim()).filter(Boolean);
  const descr = lines(t.description || p.description);
  const purpose = lines(t.purpose);
  // Текстовое значение (паспорт партии: «по таблице …») печатается как есть
  const specs = specRows(p).filter(([, v]) => has(v) || (typeof v === 'string' && v.trim() !== '')).map(([k, v]) => [String(k), has(v) ? num(v) : String(v)]);

  // Номера разделов (passport-numbering.ts): снимок с layout 2 — подряд 1…N, один «Монтаж»; прежние снимки — как печатались
  // (номера текста из снимка, обычно с 3; свободные 1…start-1 — под описание и правила).
  const plan = planNumbers({
    sections, layout: t.layout,
    hasDescr: !!(descr.length || purpose.length || specs.length), hasRules: rules.length > 0,
    hasMaintenance: maintenance.length > 0, hasInstall: !!(installLines.length || requirements.length),
  });
  const { before, mergeRules, descrNo, rulesNo, toNo, installNo, bomNo, journalNo } = plan;

  // Таблицы — сквозная нумерация в порядке документа
  const tab = new Map<string, number>();
  let tn = 0;
  if (specs.length) tab.set('specs', ++tn);
  maintenance.forEach((m, i) => { const n = ++tn; tab.set(`to:${m.period}`, n); if (i === 0) { tab.set('to', n); tab.set('maintenance', n); } });
  tab.set('bom', ++tn);
  tab.set('storage', ++tn);
  tab.set('faults', ++tn);
  // C086: тексты ссылаются на журналы ТО и ремонтов ({tab:service}, {tab:repairs}) — таблицы есть в разделе «Журналы»
  tab.set('service', ++tn);
  tab.set('repairs', ++tn);

  // Рисунки — по первой ссылке в тексте (тексты в порядке документа)
  const secTexts = sections.flatMap((s) => [s.title, ...s.items.map((i) => i.text)]);
  const descrTexts = [...descr, ...purpose, ...rules];
  const flowTexts = [...(before ? descrTexts : []), ...secTexts, ...(before ? [] : descrTexts),
    ...maintenance.flatMap((m) => m.rows.flatMap((r) => [r.what, r.where, r.measure, r.tolerance])), ...installLines, ...requirements];
  // Абзацы, после которых может встать рисунок «по месту» (в порядке вывода)
  const paraTexts = [...(before ? descrTexts : []), ...sections.flatMap((s) => s.items.map((i) => i.text)), ...(before ? [] : descrTexts), ...installLines, ...requirements];
  const figs = planFigures(flowTexts, images, paraTexts);
  const R = (s: string) => substituteRefs(s, figs.fig, tab);

  const body: V2Page[] = [];
  let cur: V2Page = { kind: 'body', draws: [], footer: true };
  let y = T;
  // Рисунки «по месту» (§3.6): не помещается после абзаца — ждёт в очереди и встаёт первым на следующей странице
  // (текст продолжает заполнять текущую); порядок рисунков сохраняется.
  const pending: PlannedFig[] = [];
  const placedKinds = new Set<string>();
  const breakPage = () => { body.push(cur); cur = { kind: 'body', draws: [], footer: true }; y = T; };
  const figSize = (f: PlannedFig) => {
    let ar = 0.62;
    try { const im = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(f.img.buf); if (im.width > 0 && im.height > 0) ar = im.height / im.width; } catch { /* битая — пропорция по умолчанию */ }
    const capH = textH('gost-i', 9, f.caption) + 4;
    const h = Math.max(60, Math.min(Wd * ar, Btm - T - capH - 14));
    return { h, capH, total: h + capH + 10 };
  };
  const putFig = (f: PlannedFig) => {
    const { h, total } = figSize(f);
    if (y + total > Btm && cur.draws.length) breakPage();
    cur.draws.push({ y, draw: (d, yy) => {
      try { d.image(f.img.buf, L, yy + 2, { fit: [Wd, h], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', L, yy + h / 2, { width: Wd, align: 'center' }); }
      d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, L, yy + h + 5, { width: Wd, align: 'center' });
    } });
    y += total;
  };
  const flush = () => { while (pending.length) putFig(pending.shift() as PlannedFig); };
  const newPage = () => { breakPage(); flush(); };
  /** После абзаца: рисунки видов, на которые здесь первая ссылка. */
  const figsAfter = (raw: string) => {
    if (!raw || !raw.includes('{fig:')) return;
    const kinds = [...raw.matchAll(/\{fig:([^}]+)\}/g)].map((m) => m[1]).filter((k, i, a) => a.indexOf(k) === i);
    for (const k of kinds) {
      if (placedKinds.has(k) || !figs.inline.has(k)) continue;
      placedKinds.add(k);
      for (const f of figs.inline.get(k) || []) {
        if (!pending.length && y + figSize(f).total <= Btm) putFig(f);
        else pending.push(f);
      }
    }
  };
  const place = (h: number, draw: Draw, keep = 0) => {
    if (y + h + keep > Btm && cur.draws.length) newPage();
    cur.draws.push({ y, draw }); y += h;
  };
  const textH = (font: string, size: number, s: string, w = Wd) => { doc.font(font).fontSize(size); return doc.heightOfString(s, { width: w, lineGap: 0.6 }); };
  const heading = (s: string, size = 12, keep = 40) => {
    const h = textH('gost', size, s) + 10;
    place(h + 4, (d, yy) => {
      d.font('gost').fontSize(size).fillColor('#000').text(s, L, yy + 4, { width: Wd, lineGap: 0.6 });
      const ly = yy + 4 + d.heightOfString(s, { width: Wd, lineGap: 0.6 }) + 2;
      d.lineWidth(1.4).strokeColor(color).moveTo(L, ly).lineTo(L + Wd, ly).stroke();
    }, keep);
  };
  const sub = (s: string) => { const h = textH('gost', 9.5, s) + 3; place(h, (d, yy) => d.font('gost').fontSize(9.5).fillColor('#000').text(s, L, yy, { width: Wd, lineGap: 0.6 }), 20); };
  const para = (s: string, size = BODY, font = 'gost-i', indent = 0) => {
    if (!s) return;
    const h = textH(font, size, s, Wd - indent) + 1.6;
    place(h, (d, yy) => d.font(font).fontSize(size).fillColor('#000').text(s, L + indent, yy, { width: Wd - indent, lineGap: 0.6 }));
  };
  const table = (title: string, cols: string[], widths: number[], rows: Cell[][], cellSize = 8, keepTogether = false) => {
    const ws = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * Wd);
    doc.font('gost-i').fontSize(7.2);
    const headH = Math.max(18, ...cols.map((c, i) => doc.heightOfString(c, { width: ws[i] - 4 }) + 6));
    const titleH = textH('gost', 9, title) + 4;
    const drawHead = (d: PDFKit.PDFDocument, yy: number) => {
      let x = L;
      d.lineWidth(0.4).strokeColor('#000');
      cols.forEach((c, i) => { d.rect(x, yy, ws[i], headH).stroke(); d.font('gost').fontSize(7.2).fillColor('#000').text(c, x + 2, yy + 3, { width: ws[i] - 4, align: 'center' }); x += ws[i]; });
      d.lineWidth(0.75).strokeColor('#000').moveTo(L, yy + headH).lineTo(L + Wd, yy + headH).stroke();
    };
    doc.font('gost-i').fontSize(cellSize);
    const heights = rows.map((r) => Math.max(15, ...r.map((c, i) => (typeof c === 'string' ? (c ? doc.heightOfString(c, { width: ws[i] - 6 }) + 6 : 0) : 'h' in c ? c.h + 4 : 0))));
    const rowsH = heights.reduce((sum, h) => sum + h, 0);
    const keep = keepTogether && titleH + headH + rowsH <= Btm - T ? rowsH : 30;
    place(titleH, (d, yy) => d.font('gost').fontSize(9).fillColor('#000').text(title, L, yy, { width: Wd }), headH + keep);
    place(headH, drawHead);
    for (const [index, r] of rows.entries()) {
      const h = heights[index];
      if (y + h > Btm) { newPage(); place(headH, drawHead); }
      place(h, (d, yy) => {
        let x = L;
        d.lineWidth(0.4).strokeColor('#000');
        r.forEach((c, i) => {
          d.rect(x, yy, ws[i], h).stroke();
          if (typeof c === 'string') {
            if (c) { d.font('gost-i').fontSize(cellSize).fillColor('#000'); const th = d.heightOfString(c, { width: ws[i] - 6 }); d.text(c, x + 3, yy + (h - th) / 2 + 1, { width: ws[i] - 6, align: /^[\d,.—-]+$/.test(c) ? 'center' : 'left' }); }
          } else if ('box' in c) {
            const s = 7.5; d.lineWidth(0.8).strokeColor('#000').rect(x + (ws[i] - s) / 2, yy + (h - s) / 2, s, s).stroke(); d.lineWidth(0.4).strokeColor('#000');
          } else if (c.img) {
            try { d.image(c.img, x + 2, yy + 2, { fit: [ws[i] - 4, h - 4], align: 'center', valign: 'center' }); } catch { /* битая миниатюра — пустая ячейка */ }
          }
          x += ws[i];
        });
      });
    }
    y += 6;
  };
  const item = (txt: string, numStr: string | null, bullet: boolean) => {
    const s = R(txt);
    if (!s) return;
    if (bullet) para(/^[—–-]\s/.test(s) ? s : `— ${s}`, BODY, 'gost-i', 6);
    else para(numStr ? `${numStr} ${s}` : s);
    figsAfter(txt);
  };
  const paraR = (raw: string, prefix = '') => { para(`${prefix}${R(raw)}`); figsAfter(raw); };
  /** Шаги способа установки и требования к основанию; `done` — сколько пунктов уже пронумеровано в разделе (монтаж внутри раздела текста). */
  const installBlock = (no: string, done: number) => {
    installLines.forEach((s, i) => paraR(s, `${no}.${done + i + 1} `));
    if (requirements.length) { y += 2; sub('Требования к основанию:'); requirements.forEach((s) => item(s, null, true)); }
  };

  // «Коротко» — одна страница
  const short = shortPage(doc, input, color, R(lines(t.purpose).join(' ') || descr[0] || ''), pb);
  if (short) body.push(short);

  const descrSection = () => {
    if (!descrNo) return;
    let k = 0;
    heading(`${descrNo} Описание и назначение`);
    if (descr.length) { sub(`${descrNo}.${++k} Описание изделия`); descr.forEach((s) => paraR(s)); y += 3; }
    if (purpose.length) { sub(`${descrNo}.${++k} Назначение`); purpose.forEach((s) => paraR(s)); y += 3; }
    if (specs.length) { sub(`${descrNo}.${++k} Основные технические данные`); table(`Таблица ${tab.get('specs')} — Габаритные размеры и масса изделия`, ['Наименование', 'Значение'], [70, 30], specs, 9); }
    if (mergeRules && rules.length) { sub(`${descrNo}.${++k} Правила пользования`); rules.forEach((s) => item(s, null, true)); }
    y += 4;
  };
  const rulesSection = () => {
    if (!rulesNo) return;
    heading(`${rulesNo} Правила пользования`);
    rules.forEach((s) => item(s, null, true));
    y += 4;
  };

  if (before) { descrSection(); rulesSection(); }
  sections.forEach((s, si) => {
    if (!s.items?.length) return;
    heading(`${plan.sectionNo[si]} ${R(s.title)}`.trim());
    for (const it of s.items) item(it.text, plan.itemNo(si, it.number), it.bullet);
    if (plan.mergeInstall && s.key === 'mounting') installBlock(plan.sectionNo[si], s.items.filter((it) => it.number).length);
    y += 4;
  });
  if (!before) { descrSection(); rulesSection(); }

  if (toNo) {
    heading(`${toNo} Техническое обслуживание (чек-лист)`);
    para('Отмечайте выполненные проверки в графе «Отм.». Неисправность — изделие закрыть для пользования до устранения.');
    y += 3;
    const dimg = input.defectImages || {};
    for (const m of maintenance) {
      const mc = maintenanceColumns(m.rows, dimg);
      table(`Таблица ${tab.get(`to:${m.period}`)} — Осмотр и обслуживание: ${m.period}`, mc.cols, mc.widths,
        m.rows.map((r) => {
          const pic = r.photoId ? dimg[r.photoId] : undefined;
          const row: Cell[] = [{ box: true }, R(r.what || '')];
          if (mc.withImg) row.push({ img: pic, h: pic ? 34 : 11 });
          row.push(R(r.where || ''), R(r.measure || ''), R(r.tolerance || ''));
          return row;
        }), 7.6);
    }
  }
  if (installNo) {
    heading(`${installNo} Монтаж`);
    installBlock(installNo, 0);
    y += 4;
  }
  // Комплектность — всегда (по умолчанию «Изделие в сборе»); миниатюры bom_item — по refCode
  heading(`${bomNo} Комплектность`);
  const thumbs = new Map<string, Buffer>();
  for (const im of images.bom_item || []) if (im.refCode && !thumbs.has(im.refCode)) thumbs.set(im.refCode, im.buf);
  const bom = p.bom?.length ? p.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
  const withImg = bom.some((b) => b.code && thumbs.has(b.code));
  const batch = isBatch(p);
  const bomRows: Cell[][] = bom.map((b, i) => {
    const row: Cell[] = batch
      ? [String(b.pos ?? i + 1), b.name ?? '', b.size ?? '', b.qty === undefined ? '' : String(b.qty), b.unit ?? '']
      : [String(b.pos ?? i + 1), b.code ?? '', b.name ?? '', b.qty === undefined ? '' : String(b.qty), b.unit ?? ''];
    if (withImg) row.push({ img: b.code ? thumbs.get(b.code) : undefined, h: b.code && thumbs.has(b.code) ? 40 : 11 });
    return row;
  });
  if (batch) table(`Таблица ${tab.get('bom')} — Комплектность и размеры изделий`, ['Поз.', 'Наименование', 'Размеры, мм', 'Кол-во', 'Ед. изм.', ...(withImg ? ['Изображение'] : [])],
    withImg ? [7, 26, 27, 9, 9, 22] : [8, 32, 38, 11, 11], bomRows);
  else table(`Таблица ${tab.get('bom')} — Комплектность изделия`, ['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед. изм.', ...(withImg ? ['Изображение'] : [])],
    withImg ? [7, 17, 36, 9, 9, 22] : [8, 20, 50, 11, 11], bomRows);

  // Журналы для заказчика (решение 2026-11-01, ПТ-2): пустые таблицы хранения и неисправностей — в обоих вариантах;
  // C086: плюс журналы ТО и ремонтов, на которые ссылаются разделы «Обслуживание», «Ремонт», «Журналы эксплуатации»
  heading(`${journalNo} Журналы`);
  const blank = (n: number): Cell[][] => Array.from({ length: n }, () => [{ h: 16 }, { h: 16 }, { h: 16 }, { h: 16 }]);
  table(`Таблица ${tab.get('storage')} — Сведения о хранении`, ['Дата установки на хранение', 'Дата снятия с хранения', 'Условия хранения', 'Должность, ФИО, подпись ответственного лица'], [18, 18, 34, 30], blank(9));
  table(`Таблица ${tab.get('faults')} — Учёт неисправностей`, ['Дата', 'Вид неисправности', 'Принятые меры', 'Должность, ФИО, подпись ответственного лица'], [14, 30, 30, 26], blank(9));
  table(`Таблица ${tab.get('service')} — Журнал технического обслуживания`, ['Дата', 'Вид работ (осмотр, обслуживание)', 'Результат, выполненные работы', 'Должность, ФИО, подпись ответственного лица'], [14, 30, 30, 26], blank(6));
  table(`Таблица ${tab.get('repairs')} — Журнал ремонтов`, ['Дата', 'Вид ремонта', 'Заменённые части', 'Исполнитель: должность, ФИО, подпись'], [14, 30, 30, 26], blank(6), 8, true);

  // Рисунки «по месту», которые не встали (ссылка только в непоказанном абзаце), и очередь — до приложений
  for (const [k, list] of figs.inline) if (!placedKinds.has(k)) { placedKinds.add(k); pending.push(...list); }
  if (pending.length) newPage();
  // Черновик помогает заполнить рисунки: видимые рамки с назначением вместо исчезнувших приложений.
  if (p.status === 'draft' && input.missingImages?.length) {
    if (cur.draws.length) newPage();
    heading('ЧЕРНОВИК — добавьте обязательные рисунки', 12, 0);
    for (const image of input.missingImages) {
      place(126, (d, yy) => {
        d.save().lineWidth(1).strokeColor('#666').rect(L, yy, Wd, 110).stroke().restore();
        d.font('gost').fontSize(12).fillColor('#000').text(image.label, L + 12, yy + 25, { width: Wd - 24, align: 'center' });
        d.font('gost-i').fontSize(10).text('Рисунок не загружен или файл не читается.\nЗагрузите его в это поле паспорта.', L + 12, yy + 52, { width: Wd - 24, align: 'center' });
      });
    }
  }
  // Приложения с рисунками
  // ряд рисунков: 1 колонка — рисунок на всю ширину; 2 колонки — сетка (4 на лист), подпись под каждым
  const figRow = (row: PlannedFig[], maxH: number, cols: number) => {
    const gap = 10, cw = (Wd - gap * (cols - 1)) / cols;
    const capH = Math.max(...row.map((f) => textH('gost-i', 9, f.caption, cw))) + 4;
    place(maxH + capH + 6, (d, yy) => {
      row.forEach((f, ci) => {
        const x = L + ci * (cw + gap);
        try { d.image(f.img.buf, x, yy, { fit: [cw, maxH], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', x, yy + maxH / 2, { width: cw, align: 'center' }); }
        d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, x, yy + maxH + 3, { width: cw, align: 'center' });
      });
    });
  };
  figs.appendices.forEach((a, ai) => {
    const cols = a.perPage >= 4 ? 2 : 1;
    for (let i = 0; i < a.figs.length; i += a.perPage) {
      if (cur.draws.length) newPage();
      heading(`Приложение ${ai + 1}${i ? ' (продолжение)' : ''}
${a.title}`, 11, 0);
      const slice = a.figs.slice(i, i + a.perPage);
      const rows: PlannedFig[][] = [];
      for (let r = 0; r < slice.length; r += cols) rows.push(slice.slice(r, r + cols));
      const room = Btm - y - 4;
      const capMax = Math.max(...slice.map((f) => textH('gost-i', 9, f.caption, (Wd - 10 * (cols - 1)) / cols)));
      // при рядах из одного рисунка делим лист на perPage/cols рядов (а не на фактическое число — чтобы одиночный не растягивался)
      const nRows = Math.max(rows.length, a.perPage / cols);
      const maxH = Math.max(60, room / nRows - capMax - 12);
      for (const row of rows) figRow(row, maxH, cols);
    }
  });
  // «Для заметок» — только если есть заметка (как v1)
  const note = String(p.note ?? '').trim();
  if (note) { if (cur.draws.length) newPage(); heading('Для заметок'); para(note, 10); }
  if (cur.draws.length) body.push(cur);
  body.forEach((pg, i) => { pg.no = i + 1; });
  if (input.mode === 'print') while ((body.length + 2) % 4) body.push({ kind: 'body', draws: [] });
  return [cover(input), ...body, warranty({ ...input, passport: p }, pb)];
}

/** «Коротко» (§3.7): плитки, «для чего», ключевые правила-пиктограммы. Пусто — страницы нет. */
