import PDFDocument from 'pdfkit';
import { join } from 'path';
import sharp from 'sharp';
import { fontDir } from './passport-pdf';
import { A5 } from './passport-pdf-v2-common';
import { layoutV2 } from './passport-pdf-v2-layout';
import type { PdfV2Input } from './passport-pdf-v2';
import { parseModules } from '../../common/passport/modules';
import { normalizePassportDefaults } from '../showcase/passport-defaults';

/** C095: паспорт сборного изделия — раздел «Состав изделия: модули» и проверка ввода модулей. */
const doc = () => {
  const d = new PDFDocument({ autoFirstPage: false });
  d.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  d.registerFont('gost-i', join(fontDir(), 'gost-a-slanted.ttf'));
  return d;
};
const PIC = 'a'.repeat(24);
const printed = async (modules?: unknown[]) => {
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  const input = {
    passport: { name: 'Экотропа', passportNumber: '1', status: 'draft', length: 120000, width: 1200, height: 90, modules },
    org: { name: 'Проверка' }, text: { sections: [], sizeLayout: 2, layout: 2 }, images: {}, moduleImages: { [PIC]: buf }, withStamp: false, mode: 'pages',
  } as unknown as PdfV2Input;
  const d = doc();
  const spy = jest.spyOn(d, 'text');
  const img = jest.spyOn(d, 'image');
  for (const p of layoutV2(d, input, '#000')) { d.addPage({ size: [A5.w, A5.h], margin: 0 }); for (const dr of p.draws) dr.draw(d, dr.y); }
  d.end();
  return { lines: spy.mock.calls.map(([s]) => String(s)), images: img.mock.calls.length };
};

describe('C095: раздел «Состав изделия: модули»', () => {
  it('1 модуль — название, габариты, количество, рисунок; без «Итого»', async () => {
    const { lines, images } = await printed([{ name: 'Прямой модуль 2 м', dims: '2000×1200×90 мм', qty: 50, photoId: PIC }]);
    expect(lines.some((s) => s.endsWith('Состав изделия: модули'))).toBe(true);
    expect(lines).toContain('1. Прямой модуль 2 м');
    expect(lines).toContain('Габариты: 2000×1200×90 мм\nКоличество: 50 шт.');
    expect(images).toBe(1);
    expect(lines.some((s) => s.includes('Итого модулей'))).toBe(false);
  });
  it('3 модуля — «Итого модулей: 27 шт.»; модуль без рисунка печатается без рамки', async () => {
    const { lines, images } = await printed([{ name: 'Прямой', qty: 20, photoId: PIC }, { name: 'Поворотный', qty: 5 }, { name: 'Торцевой', qty: 2 }]);
    expect(lines).toContain('2. Поворотный');
    expect(lines).toContain('Количество: 5 шт.');
    expect(lines).toContain('Итого модулей: 27 шт.');
    expect(images).toBe(1);
  });
  it('паспорт без модулей — раздела нет', async () => {
    expect((await printed()).lines.some((s) => s.includes('модули'))).toBe(false);
    expect((await printed([])).lines.some((s) => s.includes('модули'))).toBe(false);
  });
});

describe('C095: проверка модулей', () => {
  it('чистит и пропускает верные', () => {
    expect(parseModules([{ name: ' Прямой ', dims: '', qty: '50' }])).toEqual([{ name: 'Прямой', qty: 50 }]);
    expect(parseModules(null)).toEqual([]);
  });
  it('ошибки по-русски с номером модуля', () => {
    expect(() => parseModules([{ name: 'А', qty: 1 }, { name: '', qty: 1 }])).toThrow('Модуль 2: укажите название');
    expect(() => parseModules([{ name: 'А', qty: 0 }])).toThrow('Модуль 1: количество — целое от 1 до 10000');
    expect(() => parseModules([{ name: 'А', qty: 1.5 }])).toThrow('Модуль 1: количество — целое от 1 до 10000');
    expect(() => parseModules(Array.from({ length: 21 }, () => ({ name: 'А', qty: 1 })))).toThrow('Не больше 20 модулей');
  });
  it('умолчания изделия: modules сохраняются, пустой список — поля нет', () => {
    expect(normalizePassportDefaults({ modules: [{ name: 'Прямой', qty: 50 }] }).modules).toEqual([{ name: 'Прямой', qty: 50 }]);
    expect(normalizePassportDefaults({ modules: [] }).modules).toBeUndefined();
  });
});
