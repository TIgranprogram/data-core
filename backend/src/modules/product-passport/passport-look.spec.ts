import sharp from 'sharp';
import { boxFromMm, firmAccent, mmToPt } from './passport-look-metrics';
import { renderPassportCoverPreview, renderPassportPdfV2, type PdfV2Input } from './passport-pdf-v2';

const count = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const jpeg = (color: string) => sharp({ create: { width: 420, height: 595, channels: 3, background: color } }).jpeg({ quality: 70 }).toBuffer();

const BASE: PdfV2Input = {
  passport: { passportNumber: '700', name: 'Комплекс игровой', height: 2500, length: 4000, width: 3000, weight: 350, warrantyMonths: 12, ageFrom: 3, passportCategory: 'DIO', certificate: { hasEac: true } },
  org: { name: 'ООО «СпортИнЮг»', shortName: 'СпортИнЮг', inn: '2310181417', trademark: 'STREET IRON' },
  text: {
    sections: [{ key: 'w', number: '3', title: 'Гарантии изготовителя', items: [{ key: 'p1', number: '3.1', bullet: false, text: 'Гарантийный срок — 12 месяцев.' }] }],
    description: 'Игровой комплекс.',
    purpose: 'Игры на площадке.',
    rules: ['Не пользоваться мокрым'],
  },
  images: {},
  style: { color: '#2E7D32', categoryName: 'Детское игровое оборудование', icons: ['Осмотрите оборудование'] },
  withStamp: false,
  mode: 'pages',
};

describe('вид паспорта фирмы (C076)', () => {
  it('цвет без фона не меняет чёрный; поля в мм становятся пунктами', () => {
    expect(firmAccent({ color: '#C62828' })).toBe('#000');
    expect(firmAccent({ color: '#C62828', cover: Buffer.from('x') })).toBe('#C62828');
    expect(firmAccent({ color: '#C62828', page: Buffer.from('x') }, true)).toBe('#000');
    expect(firmAccent({ color: 'красный', cover: Buffer.from('x') })).toBe('#000');
    expect(boxFromMm(null)).toBeNull();
    expect(boxFromMm({})).toBeNull();
    const box = boxFromMm({ top: 20 });
    expect(box).toMatchObject({ t: mmToPt(20), l: 34, r: 28, b: 44 });
  });

  it('PDF без фона тот же; с фоном тяжелеет не больше картинок и не на каждую страницу', async () => {
    const plain = await renderPassportPdfV2(BASE);
    const tinted = await renderPassportPdfV2({ ...BASE, look: { color: '#C62828' } });
    // В PDF каждый раз новый /ID и дата — сравниваем размер: цвет без картинки байт не добавляет.
    expect(tinted.length).toBe(plain.length);

    const cover = await jpeg('#1565c0');
    const page = await jpeg('#eceff1');
    const withBg = await renderPassportPdfV2({ ...BASE, look: { cover, page, color: '#C62828' } });
    expect(withBg.subarray(0, 5).toString()).toBe('%PDF-');
    expect(count(withBg)).toBe(count(plain));
    const grew = withBg.length - plain.length;
    expect(grew).toBeGreaterThan(0);
    expect(grew).toBeLessThanOrEqual(cover.length + page.length + 2500);
    expect(grew).toBeLessThan((cover.length + page.length) * count(plain));
    const preview = await renderPassportCoverPreview({ ...BASE, look: { cover, color: '#C62828' } });
    expect(count(preview)).toBe(1);
    expect(preview.length - (await renderPassportCoverPreview(BASE)).length).toBeLessThanOrEqual(cover.length + 2500);
  });
});
