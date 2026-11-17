import { promises as fs } from 'fs';
import { Types } from 'mongoose';
import * as path from 'path';
import { FakeDb } from '../control/questions/fake-db.testkit';
import { UPLOAD_DIR } from '../photos/image-upload.options';
import { PassportPdfService } from './passport-pdf.service';

const names = (zip: Buffer) => { // имена файлов из локальных заголовков ZIP без сжатия
  const out: string[] = [];
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const n = zip.readUInt16LE(i + 26);
    out.push(zip.subarray(i + 30, i + 30 + n).toString('utf8'));
    i += 29 + n + zip.readUInt32LE(i + 18);
  }
  return out;
};

describe('архив паспортов заказа: паспорта поставщика (C136)', () => {
  const rel = `attachments/c136-${Date.now()}/supplier.pdf`;
  afterAll(() => fs.rm(path.dirname(path.join(path.resolve(UPLOAD_DIR), rel)), { recursive: true, force: true }));

  async function run(withFile: boolean) {
    const db = new FakeDb();
    const [order, prod, valve, grip] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
    db.collection('materials').rows.push({ _id: valve, name: 'Кран', materialKind: 'purchased', deletedAt: null }, { _id: grip, name: 'Ручка', materialKind: 'purchased', deletedAt: null });
    db.collection('products').rows.push({ _id: prod, composition: [{ lineType: 'material', refId: valve }, { lineType: 'material', refId: grip }] });
    db.collection('incomes').rows.push({ _id: new Types.ObjectId(), orderId: order, productId: prod, deletedAt: null, cancelledAt: null });
    if (withFile) {
      const abs = path.join(path.resolve(UPLOAD_DIR), rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, '%PDF-1.7 supplier');
      db.collection('productattachments').rows.push({ _id: new Types.ObjectId(), materialId: valve, storedPath: rel, ext: 'pdf', uploadedAt: new Date(), deletedAt: null });
    }
    const markIssued = jest.fn();
    const svc = new PassportPdfService({ list: async () => ({ items: [] }), markIssued } as never, {} as never, { db } as never);
    const r = await svc.zip({ salesOrderId: String(order) }, {});
    return { ...r, markIssued };
  }

  it('файл есть — в архиве «Поставщик_Кран.pdf»; у «Ручка» нет — строка и missing; выпуск не отмечается', async () => {
    const r = await run(true);
    expect(names(r.buf)).toEqual(['Поставщик_Кран.pdf', '_Нет_паспортов_поставщика.txt']);
    expect(r.buf.includes(Buffer.from('нет паспорта поставщика: Ручка'))).toBe(true);
    expect(r.missing.map((m) => m.name)).toEqual(['Ручка']);
    expect(r.markIssued).not.toHaveBeenCalled();
  });

  it('ни у кого нет файла — архив собирается, оба в missing', async () => {
    const r = await run(false);
    expect(names(r.buf)).toEqual(['_Нет_паспортов_поставщика.txt']);
    expect(r.missing).toHaveLength(2);
  });

  it('без salesOrderId — как раньше: ничего лишнего', async () => {
    const svc = new PassportPdfService({ list: async () => ({ items: [] }) } as never, {} as never, { db: new FakeDb() } as never);
    const r = await svc.zip({}, {});
    expect(r.missing).toEqual([]);
    expect(names(r.buf)).toEqual([]);
  });
});
