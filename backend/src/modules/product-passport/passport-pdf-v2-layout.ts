import { warranty } from './passport-pdf';
import { PdfV2Input } from './passport-pdf-v2-types';
import { substituteRefs, PlannedFig, planFigures, maintenanceColumns } from './passport-pdf-v2-refs';
import { M, CW, BOTTOM, BODY, Draw, Cell, V2Page, has, num, lines } from './passport-pdf-v2-common';
import { shortPage, cover } from './passport-pdf-v2-cover';

export function layoutV2(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string): V2Page[] {
  const { passport: p, text: t, images } = input;
  const sections = (t.sections || []).filter((s) => s.items?.length || s.title);
  const maintenance = (t.maintenance || []).filter((m) => m.rows?.length);
  const installLines = lines(t.install?.text);
  const requirements = (t.install?.requirements || []).map((x) => String(x).trim()).filter(Boolean);
  const rules = (t.rules || []).map((x) => String(x).trim()).filter(Boolean);
  const descr = lines(t.description || p.description);
  const purpose = lines(t.purpose);
  const specs: string[][] = [['Высота, мм', p.height], ['Длина, мм', p.length], ['Ширина, мм', p.width], ['Вес, кг', p.weight]]
    .filter(([, v]) => has(v)).map(([k, v]) => [String(k), num(v)]);

  // Номера разделов: снимок даёт свои (обычно с 3 — 1 и 2 были «Описание» и «Техданные» v1). Свободные 1…start-1 — под описание/правила.
  const start = parseInt(sections[0]?.number ?? '', 10) || 1;
  const lastNo = sections.reduce((m, s) => Math.max(m, parseInt(s.number, 10) || 0), 0);
  const descrBlock = descr.length || purpose.length || specs.length;
  const rulesBlock = rules.length > 0;
  const before = start > 1;
  const mergeRules = before && start === 2; // один свободный номер — правила внутри описания
  let next = before ? 1 : lastNo + 1;
  const descrNo = descrBlock || (mergeRules && rulesBlock) ? String(next++) : '';
  const rulesNo = rulesBlock && !mergeRules ? String(next++) : '';
  if (before) next = lastNo + 1;
  const toNo = maintenance.length ? String(next++) : '';
  const installNo = installLines.length || requirements.length ? String(next++) : '';
  const bomNo = String(next++);

  // Таблицы — сквозная нумерация в порядке документа
  const tab = new Map<string, number>();
  let tn = 0;
  if (specs.length) tab.set('specs', ++tn);
  maintenance.forEach((m, i) => { const n = ++tn; tab.set(`to:${m.period}`, n); if (i === 0) { tab.set('to', n); tab.set('maintenance', n); } });
  tab.set('bom', ++tn);

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
  let y = M.t;
  // Рисунки «по месту» (§3.6): не помещается после абзаца — ждёт в очереди и встаёт первым на следующей странице
  // (текст продолжает заполнять текущую); порядок рисунков сохраняется.
  const pending: PlannedFig[] = [];
  const placedKinds = new Set<string>();
  const breakPage = () => { body.push(cur); cur = { kind: 'body', draws: [], footer: true }; y = M.t; };
  const figSize = (f: PlannedFig) => {
    let ar = 0.62;
    try { const im = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(f.img.buf); if (im.width > 0 && im.height > 0) ar = im.height / im.width; } catch { /* битая — пропорция по умолчанию */ }
    const capH = textH('gost-i', 9, f.caption) + 4;
    const h = Math.max(60, Math.min(CW * ar, BOTTOM - M.t - capH - 14));
    return { h, capH, total: h + capH + 10 };
  };
  const putFig = (f: PlannedFig) => {
    const { h, total } = figSize(f);
    if (y + total > BOTTOM && cur.draws.length) breakPage();
    cur.draws.push({ y, draw: (d, yy) => {
      try { d.image(f.img.buf, M.l, yy + 2, { fit: [CW, h], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', M.l, yy + h / 2, { width: CW, align: 'center' }); }
      d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, M.l, yy + h + 5, { width: CW, align: 'center' });
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
        if (!pending.length && y + figSize(f).total <= BOTTOM) putFig(f);
        else pending.push(f);
      }
    }
  };
  const place = (h: number, draw: Draw, keep = 0) => {
    if (y + h + keep > BOTTOM && cur.draws.length) newPage();
    cur.draws.push({ y, draw }); y += h;
  };
  const textH = (font: string, size: number, s: string, w = CW) => { doc.font(font).fontSize(size); return doc.heightOfString(s, { width: w, lineGap: 0.6 }); };
  const heading = (s: string, size = 12, keep = 40) => {
    const h = textH('gost', size, s) + 10;
    place(h + 4, (d, yy) => {
      d.font('gost').fontSize(size).fillColor('#000').text(s, M.l, yy + 4, { width: CW, lineGap: 0.6 });
      const ly = yy + 4 + d.heightOfString(s, { width: CW, lineGap: 0.6 }) + 2;
      d.lineWidth(1.4).strokeColor(color).moveTo(M.l, ly).lineTo(M.l + CW, ly).stroke();
    }, keep);
  };
  const sub = (s: string) => { const h = textH('gost', 9.5, s) + 3; place(h, (d, yy) => d.font('gost').fontSize(9.5).fillColor('#000').text(s, M.l, yy, { width: CW, lineGap: 0.6 }), 20); };
  const para = (s: string, size = BODY, font = 'gost-i', indent = 0) => {
    if (!s) return;
    const h = textH(font, size, s, CW - indent) + 1.6;
    place(h, (d, yy) => d.font(font).fontSize(size).fillColor('#000').text(s, M.l + indent, yy, { width: CW - indent, lineGap: 0.6 }));
  };
  const table = (title: string, cols: string[], widths: number[], rows: Cell[][], cellSize = 8) => {
    const ws = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * CW);
    doc.font('gost-i').fontSize(7.2);
    const headH = Math.max(18, ...cols.map((c, i) => doc.heightOfString(c, { width: ws[i] - 4 }) + 6));
    const titleH = textH('gost', 9, title) + 4;
    const drawHead = (d: PDFKit.PDFDocument, yy: number) => {
      let x = M.l;
      d.save().fillColor(color).fillOpacity(0.12).rect(M.l, yy, CW, headH).fill().restore();
      d.lineWidth(0.4).strokeColor('#555');
      cols.forEach((c, i) => { d.rect(x, yy, ws[i], headH).stroke(); d.font('gost-i').fontSize(7.2).fillColor('#000').text(c, x + 2, yy + 3, { width: ws[i] - 4, align: 'center' }); x += ws[i]; });
    };
    place(titleH, (d, yy) => d.font('gost').fontSize(9).fillColor('#000').text(title, M.l, yy, { width: CW }), headH + 30);
    place(headH, drawHead);
    for (const r of rows) {
      doc.font('gost-i').fontSize(cellSize);
      const h = Math.max(15, ...r.map((c, i) => (typeof c === 'string' ? (c ? doc.heightOfString(c, { width: ws[i] - 6 }) + 6 : 0) : 'h' in c ? c.h + 4 : 0)));
      if (y + h > BOTTOM) { newPage(); place(headH, drawHead); }
      place(h, (d, yy) => {
        let x = M.l;
        d.lineWidth(0.4).strokeColor('#555');
        r.forEach((c, i) => {
          d.rect(x, yy, ws[i], h).stroke();
          if (typeof c === 'string') {
            if (c) { d.font('gost-i').fontSize(cellSize).fillColor('#000'); const th = d.heightOfString(c, { width: ws[i] - 6 }); d.text(c, x + 3, yy + (h - th) / 2 + 1, { width: ws[i] - 6, align: /^[\d,.—-]+$/.test(c) ? 'center' : 'left' }); }
          } else if ('box' in c) {
            const s = 7.5; d.lineWidth(0.8).strokeColor('#000').rect(x + (ws[i] - s) / 2, yy + (h - s) / 2, s, s).stroke(); d.lineWidth(0.4).strokeColor('#555');
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

  // «Коротко» — одна страница
  const short = shortPage(doc, input, color, R(lines(t.purpose).join(' ') || descr[0] || ''));
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
  for (const s of sections) {
    if (!s.items?.length) continue;
    heading(`${s.number} ${R(s.title)}`.trim());
    for (const it of s.items) item(it.text, it.number, it.bullet);
    y += 4;
  }
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
    installLines.forEach((s, i) => paraR(s, `${installNo}.${i + 1} `));
    if (requirements.length) { y += 2; sub('Требования к основанию:'); requirements.forEach((s) => item(s, null, true)); }
    y += 4;
  }
  // Комплектность — всегда (по умолчанию «Изделие в сборе»); миниатюры bom_item — по refCode
  heading(`${bomNo} Комплектность`);
  const thumbs = new Map<string, Buffer>();
  for (const im of images.bom_item || []) if (im.refCode && !thumbs.has(im.refCode)) thumbs.set(im.refCode, im.buf);
  const bom = p.bom?.length ? p.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
  const withImg = bom.some((b) => b.code && thumbs.has(b.code));
  const bomRows: Cell[][] = bom.map((b, i) => {
    const row: Cell[] = [String(b.pos ?? i + 1), b.code ?? '', b.name ?? '', b.qty === undefined ? '' : String(b.qty), b.unit ?? ''];
    if (withImg) row.push({ img: b.code ? thumbs.get(b.code) : undefined, h: b.code && thumbs.has(b.code) ? 40 : 11 });
    return row;
  });
  table(`Таблица ${tab.get('bom')} — Комплектность изделия`, ['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед. изм.', ...(withImg ? ['Изображение'] : [])],
    withImg ? [7, 17, 36, 9, 9, 22] : [8, 20, 50, 11, 11], bomRows);

  // Рисунки «по месту», которые не встали (ссылка только в непоказанном абзаце), и очередь — до приложений
  for (const [k, list] of figs.inline) if (!placedKinds.has(k)) { placedKinds.add(k); pending.push(...list); }
  if (pending.length) newPage();
  // Приложения с рисунками
  const figBlock = (f: PlannedFig, maxH: number) => {
    const capH = textH('gost-i', 9, f.caption) + 4;
    place(maxH + capH + 6, (d, yy) => {
      try { d.image(f.img.buf, M.l, yy, { fit: [CW, maxH], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', M.l, yy + maxH / 2, { width: CW, align: 'center' }); }
      d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, M.l, yy + maxH + 3, { width: CW, align: 'center' });
    });
  };
  figs.appendices.forEach((a, ai) => {
    for (let i = 0; i < a.figs.length; i += a.perPage) {
      if (cur.draws.length) newPage();
      heading(`Приложение ${ai + 1}${i ? ' (продолжение)' : ''}\n${a.title}`, 11, 0);
      const slice = a.figs.slice(i, i + a.perPage);
      const room = BOTTOM - y - 4;
      for (const f of slice) figBlock(f, Math.max(60, room / slice.length - textH('gost-i', 9, f.caption) - 12));
    }
  });
  // «Для заметок» — только если есть заметка (как v1)
  const note = String(p.note ?? '').trim();
  if (note) { if (cur.draws.length) newPage(); heading('Для заметок'); para(note, 10); }
  if (cur.draws.length) body.push(cur);
  body.forEach((pg, i) => { pg.no = i + 1; });
  if (input.mode === 'print') while ((body.length + 2) % 4) body.push({ kind: 'body', draws: [] });
  return [cover(input, color), ...body, warranty({ ...input, passport: p })];
}

/** «Коротко» (§3.7): плитки, «для чего», ключевые правила-пиктограммы. Пусто — страницы нет. */
