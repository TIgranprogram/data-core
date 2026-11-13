import PDFDocument from 'pdfkit';
import { join } from 'path';
import sharp from 'sharp';
import { fontDir } from './passport-pdf';
import { A5 } from './passport-pdf-v2-common';
import { layoutV2 } from './passport-pdf-v2-layout';
import type { PdfV2Input } from './passport-pdf-v2';

/** C105: «Глубина Г = N мм» — первой строкой подписи схемы установки опор; нет глубины — строки нет. */
const doc = () => {
  const d = new PDFDocument({ autoFirstPage: false });
  d.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  d.registerFont('gost-i', join(fontDir(), 'gost-a-slanted.ttf'));
  return d;
};
const printed = async (foundationDepth?: number) => {
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  const input = {
    passport: { name: 'Стелла', passportNumber: '1', status: 'draft', length: 2708, width: 288, height: 7003, foundationDepth },
    org: { name: 'Проверка' }, text: { sections: [], sizeLayout: 2, layout: 2 }, images: { foundation: [{ buf }] }, withStamp: false, mode: 'pages',
  } as unknown as PdfV2Input;
  const d = doc();
  const spy = jest.spyOn(d, 'text');
  for (const p of layoutV2(d, input, '#000')) { d.addPage({ size: [A5.w, A5.h], margin: 0 }); for (const dr of p.draws) dr.draw(d, dr.y); }
  d.end();
  return spy.mock.calls.map(([s]) => String(s));
};

describe('C105: глубина Г под схемой установки', () => {
  it('есть глубина — подпись «Глубина Г = 850 мм» перед «Рисунок …»', async () => {
    const lines = await printed(850);
    expect(lines.some((s) => s.startsWith('Глубина Г = 850 мм\nРисунок'))).toBe(true);
  });
  it('нет глубины или 0 — строки нет', async () => {
    expect((await printed()).some((s) => s.includes('Глубина Г'))).toBe(false);
    expect((await printed(0)).some((s) => s.includes('Глубина Г'))).toBe(false);
  });
});
