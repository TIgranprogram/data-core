import PDFDocument from 'pdfkit';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { fontDir, imposition } from './passport-pdf';
import { A5, A4L, fitText } from './passport-pdf-v2-common';
import { layoutV2, specRows } from './passport-pdf-v2-layout';
import { renderPassportPdfV2, PdfV2Input } from './passport-pdf-v2';

const OUT = process.env.PDFV2_OUT;
const save = (name: string, value: Buffer | string) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), value); } };
const count = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const input: PdfV2Input = { passport: { name: 'Контрольный паспорт', passportNumber: '96', status: 'draft', length: 1000, width: 500, height: 400 }, org: { name: 'Проверка печати' }, text: { sections: [], sizeLayout: 2, layout: 2 }, images: {}, withStamp: false, mode: 'pages' };
const measureDoc = () => {
  const d = new PDFDocument({ autoFirstPage: false });
  d.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  d.registerFont('gost-i', join(fontDir(), 'gost-a-slanted.ttf'));
  return d;
};

describe('C096: переносы и спуск реального PDF', () => {
  it('новый снимок сохраняет размеры после выпуска; старый выпущенный сохраняет прежние строки', () => {
    expect(specRows(input.passport, true)).toEqual(specRows({ ...input.passport, status: 'issued' }, true));
    expect(specRows({ ...input.passport, status: 'issued' }).map(([k]) => k)).toEqual(['Высота, мм', 'Длина, мм', 'Ширина, мм', 'Масса, кг']);
  });
  it.each([undefined, 2])('старый issued с layout=%s не получает новую таблицу без sizeLayout', (layout) => {
    const d = measureDoc();
    const spy = jest.spyOn(d, 'text');
    const pages = layoutV2(d, { ...input, passport: { ...input.passport, status: 'issued' }, text: { sections: [], layout } }, '#000');
    for (const p of pages) { d.addPage({ size: [A5.w, A5.h], margin: 0 }); for (const draw of p.draws) draw.draw(d, draw.y); }
    const printed = spy.mock.calls.map(([s]) => s);
    expect(printed).toContain('Высота, мм');
    expect(printed).not.toContain('Длина (L), мм');
    d.end();
  });
  it('деление не теряет символы, включая слово без пробелов', () => {
    for (const original of ['слово '.repeat(100), 'А'.repeat(400)]) {
      let rest = original, joined = '';
      while (rest) { const [a, b] = fitText(rest, 20, (v) => v.length); expect(a.length).toBeGreaterThan(0); expect(a.length).toBeLessThanOrEqual(20); joined += a; rest = b; }
      expect(joined).toBe(original);
    }
  });
  it.each([1, 2, 3, 4, 5, 7, 8, 9, 12])('N=%i: маркированные страницы, обе стороны и виртуальное складывание', async (n) => {
    const padded = Math.ceil(n / 4) * 4;
    const pairs = imposition(padded);
    expect(pairs).toHaveLength(2 * Math.ceil(n / 4));
    expect(pairs.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: padded }, (_, i) => i));
    const folded = Array<number>(padded);
    pairs.forEach(([l, r], side) => {
      const sheet = Math.floor(side / 2);
      if (side % 2 === 0) { folded[2 * sheet] = r; folded[padded - 1 - 2 * sheet] = l; }
      else { folded[2 * sheet + 1] = l; folded[padded - 2 - 2 * sheet] = r; }
    });
    expect(folded).toEqual(Array.from({ length: padded }, (_, i) => i));
    if (n === 8) expect(pairs).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
    const make = async (print: boolean) => {
      const d = new PDFDocument({ autoFirstPage: false, margin: 0 });
      const chunks: Buffer[] = []; d.on('data', (b: Buffer) => chunks.push(b));
      const done = new Promise<Buffer>((resolve) => d.on('end', () => resolve(Buffer.concat(chunks))));
      const draw = (i: number, x: number) => {
        if (i >= n) return;
        d.fontSize(20).text('TOP ^', x + 30, 30, { lineBreak: false });
        d.fontSize(90).text(String(i + 1), x + 160, 220, { lineBreak: false });
        d.fontSize(14).text(`PAGE ${i + 1} / ${n}`, x + 30, 540, { lineBreak: false });
      };
      if (print) for (const [l, r] of pairs) { d.addPage({ size: [A4L.w, A4L.h], margin: 0 }); draw(l, 0); draw(r, A4L.w / 2); }
      else for (let i = 0; i < n; i++) { d.addPage({ size: [A5.w, A5.h], margin: 0 }); draw(i, 0); }
      d.end(); return done;
    };
    save(`marked-${n}-pages.pdf`, await make(false)); save(`marked-${n}-print.pdf`, await make(true));
    save(`marked-${n}-mapping.json`, JSON.stringify(pairs.map(([l, r], i) => ({ sheet: Math.floor(i / 2) + 1, side: i % 2 ? 'back' : 'front', left: l < n ? l + 1 : null, right: r < n ? r + 1 : null })), null, 2));
  });
  it('короткий и длинный паспорта: PDFKit не создаёт страницы сверх раскладки', async () => {
    const pic = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#c6e5f5' } }).composite([{ input: Buffer.from('<svg width="600" height="300"><rect x="20" y="20" width="560" height="260" fill="none" stroke="black" stroke-width="6"/><path d="M50 250L300 40L550 250Z" fill="none" stroke="black" stroke-width="8"/></svg>') }]).png().toBuffer();
    const long: PdfV2Input = { ...input, passport: { ...input.passport, note: 'Контроль заметки. '.repeat(250), bom: [{ code: 'АРТИКУЛ'.repeat(150), name: 'Длинная строка комплектности. '.repeat(100), qty: 1 }] },
      text: { sections: [], sizeLayout: 2, layout: 2, description: 'Описание изделия и требований безопасности. '.repeat(150) + ' См. {fig:dimensions}', maintenance: [{ period: 'ежедневно', rows: [{ what: 'Проверка поверхности. '.repeat(100), where: 'ЗОНА'.repeat(180), measure: 'Устранить повреждение. '.repeat(70), tolerance: 'Без повреждений' }] }] },
      images: { dimensions: Array.from({ length: 12 }, () => ({ buf: pic })) } };
    for (const [name, value] of [['short', input], ['long', long]] as const) {
      for (const mode of ['pages', 'print'] as const) {
        const v = { ...value, mode };
        const d = measureDoc(); const layout = layoutV2(d, v, '#000'); d.end();
        expect(layout.every((p) => p.kind !== 'body' || p.draws.length || mode === 'print')).toBe(true);
        const result = await renderPassportPdfV2(v);
        expect(count(result)).toBe(mode === 'pages' ? layout.length : layout.length / 2);
        save(`${name}-${mode}.pdf`, result);
      }
    }
  });
});
