import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { cleanModules, modulesTotal } from './passport-modules';
import { renderPassportPdfV2, renderPassportsPdfV2, type PdfV2Input } from './passport-pdf-v2';

/** Образцы PDF C095: MODULES_OUT=<папка> npx jest passport-modules */
const OUT = process.env.MODULES_OUT;
const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const imgs = (b: Buffer) => (b.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

const BASE: PdfV2Input = {
  passport: { passportNumber: '900', warrantyCode: '202611-900', productCode: 'ОГР-1', name: 'Ограждение спортивной площадки', height: 1200, length: 2500, width: 60, weight: 20, warrantyMonths: 12, passportCategory: 'BLG' },
  org: { name: 'ООО «Пример»', shortName: 'Пример', inn: '2310000000' },
  text: { sections: [{ key: 'w', number: '1', title: 'Гарантии изготовителя', items: [{ key: 'p', number: '1.1', bullet: false, text: 'Гарантийный срок — 12 месяцев.' }] }], layout: 2 },
  images: {}, withStamp: false, mode: 'pages',
};

describe('C095 варианты модуля', () => {
  it('чистка: без названия или с нецелым/нулевым количеством — вариант отбрасывается', () => {
    expect(cleanModules([{ name: ' Секция ', size: '2500 мм', qty: 20 }, { name: '', qty: 3 }, { name: 'X', qty: 0 }, { name: 'Y', qty: 1.5 }]))
      .toEqual([{ name: 'Секция', size: '2500 мм', qty: 20, photoId: '' }]);
    expect(cleanModules(undefined)).toEqual([]);
  });

  it('всего модулей — сумма: 20 + 5 + 2 = 27', () => {
    expect(modulesTotal([{ name: 'A', qty: 20 }, { name: 'B', qty: 5 }, { name: 'C', qty: 2 }])).toBe(27);
  });

  it('PDF: обычный паспорт, один вариант, три варианта (один без рисунка); рисунок вкладывается только при наличии', async () => {
    const pic = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#9ab' } }).png().toBuffer();
    const pid1 = 'a'.repeat(24), pid2 = 'b'.repeat(24);
    const plain = await renderPassportPdfV2(BASE);
    const one = await renderPassportPdfV2({ ...BASE, passport: { ...BASE.passport, moduleVariants: [{ name: 'Секция 2500', size: '2500 × 1200 × 60 мм', qty: 20, photoId: pid1 }] }, moduleImages: { [pid1]: pic } });
    const three = await renderPassportPdfV2({ ...BASE, passport: { ...BASE.passport, moduleVariants: [
      { name: 'Секция 2500', size: '2500 × 1200 × 60 мм', qty: 20, photoId: pid1 },
      { name: 'Секция 1250', size: '1250 × 1200 × 60 мм', qty: 5, photoId: pid2 },
      { name: 'Калитка', size: '1000 × 1200 × 60 мм', qty: 2 },
    ] }, moduleImages: { [pid1]: pic, [pid2]: pic } });
    for (const b of [plain, one, three]) expect(b.subarray(0, 5).toString()).toBe('%PDF-');
    expect(imgs(plain)).toBe(0);
    expect(imgs(one)).toBe(1);
    expect(imgs(three)).toBe(2); // два варианта с рисунком, у калитки рисунка нет
    expect(pages(three)).toBeGreaterThanOrEqual(pages(plain));
    // экспорт: несколько паспортов в одном файле (PDF заказа) — тот же рендер
    const order = await renderPassportsPdfV2([BASE, { ...BASE, passport: { ...BASE.passport, passportNumber: '901', moduleVariants: [{ name: 'Калитка', qty: 2 }] } }]);
    expect(pages(order)).toBeGreaterThan(pages(plain));
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'c095-plain.pdf'), plain);
      writeFileSync(join(OUT, 'c095-one.pdf'), one);
      writeFileSync(join(OUT, 'c095-three.pdf'), three);
      writeFileSync(join(OUT, 'c095-print-a4.pdf'), await renderPassportPdfV2({ ...BASE, mode: 'print', passport: { ...BASE.passport, moduleVariants: [{ name: 'Секция 2500', size: '2500 × 1200 × 60 мм', qty: 20 }, { name: 'Калитка', qty: 2 }] } }));
    }
  });
});

describe('C095 DTO варианта модуля', () => {
  it('количество — целое > 0, название обязательно', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { CreateProductPassportDto } = await import('./dto/create-product-passport.dto');
    const errs = async (moduleVariants: unknown) => (await validate(plainToInstance(CreateProductPassportDto, { moduleVariants }))).length;
    expect(await errs([{ name: 'Секция', size: '2500 мм', qty: 20 }])).toBe(0);
    expect(await errs([{ name: 'Секция', qty: 0 }])).toBeGreaterThan(0);
    expect(await errs([{ name: 'Секция', qty: 1.5 }])).toBeGreaterThan(0);
    expect(await errs([{ qty: 2 }])).toBeGreaterThan(0);
    expect(await errs([])).toBe(0);
  });
});
