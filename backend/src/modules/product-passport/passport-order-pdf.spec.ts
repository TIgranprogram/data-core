import { BadRequestException } from '@nestjs/common';
import { PassportPdfService, failReason } from './passport-pdf.service';
import { Types } from 'mongoose';
import { renderPassportPdfV2, renderPassportsPdfV2 } from './passport-pdf-v2';

jest.mock('./passport-pdf-v2', () => ({ ...jest.requireActual('./passport-pdf-v2'), renderPassportPdfV2: jest.fn(async () => Buffer.from('%PDF-test')), renderPassportsPdfV2: jest.fn(async () => Buffer.from('%PDF-test')) }));

/** Р5 (C112): печать заказа — один паспорт не собрался, остальные печатаются, несобранные идут списком с причиной. */
const pass = (n: string) => ({ _id: `id${n}`, passportNumber: n, name: `Изделие ${n}`, textSnapshot: { sections: [{ key: 'a' }] } });

function service(items: unknown[]) {
  const passports = { issuedOfOrder: jest.fn(async () => ({ items, orderNo: '77' })), markIssued: jest.fn(async () => undefined) };
  const svc = new PassportPdfService(passports as never, {} as never, {} as never);
  return { svc, passports };
}

describe('Р5: печать заказа при сбое одного паспорта', () => {
  it('C148: одиночный и общий PDF сохраняют имена и текст двух старых issued без manualText', async () => {
    const photoId = new Types.ObjectId();
    const items = ['Имя первого экземпляра', 'Имя второго экземпляра'].map((name, i) => ({
      _id: new Types.ObjectId(), incomeId: new Types.ObjectId(), status: 'issued', passportNumber: String(i + 1), name,
      passportCategory: 'BLG', textSnapshot: { sections: [{ key: 'a', title: name, items: [{ text: `${name}: ручная строка` }] }], description: name },
    }));
    const source = JSON.stringify(items);
    const passports = {
      issuedOfOrder: jest.fn(async () => ({ items, orderNo: '77' })),
      syncFromProduct: jest.fn(async () => false),
      findById: jest.fn(async (id: string) => ({ toObject: () => items.find((p) => String(p._id) === id)! })),
      effectiveImages: async () => [{ kind: 'overview', photoId }], installs: async () => new Map(),
      categoryRules: async () => new Map([['BLG', { requiredImages: '' }]]),
      markIssued: jest.fn(async () => {}), create: jest.fn(), issue: jest.fn(),
    };
    const collection = jest.fn((name: string) => ({
      findOne: jest.fn(async () => name === 'incomes' ? { title: 'Название позиции договора' } : null),
      find: () => ({ toArray: async () => name === 'photos' ? [{ _id: photoId, storageUrl: '/uploads/test.png' }] : [] }),
    }));
    const svc = new PassportPdfService(passports as never, { forPdf: async () => ({}) } as never, { collection } as never);
    Object.assign(svc, { file: async () => Buffer.from('image fixture') });
    jest.mocked(renderPassportPdfV2).mockClear();
    jest.mocked(renderPassportsPdfV2).mockClear();
    for (const p of items) await svc.pdf(String(p._id));
    await svc.orderPdf('order', {}, items.map((p) => String(p._id)));
    const singles = jest.mocked(renderPassportPdfV2).mock.calls.map(([input]) => input);
    const batch = jest.mocked(renderPassportsPdfV2).mock.calls[0][0];
    expect(singles.map((p) => p.passport.name)).toEqual(items.map((p) => p.name));
    expect(batch.map((p) => p.passport.name)).toEqual(items.map((p) => p.name));
    expect(batch.map((p) => p.passport)).toEqual(items);
    expect(batch.map((p) => p.text)).toEqual(singles.map((p) => p.text));
    expect(batch.map((p) => p.text.description)).toEqual(items.map((p) => p.name));
    expect(JSON.stringify(items)).toBe(source);
    expect(collection).not.toHaveBeenCalledWith('incomes');
    expect(passports.create).not.toHaveBeenCalled();
    expect(passports.issue).not.toHaveBeenCalled();
    const draft = { ...items[0], status: 'draft', name: 'Ручное имя черновика', manualText: ['name'] };
    passports.findById.mockResolvedValueOnce({ toObject: () => draft });
    await svc.pdf(String(draft._id));
    expect(jest.mocked(renderPassportPdfV2).mock.calls[2][0].passport.name).toBe('Ручное имя черновика');
  });
  it('остальные печатаются, несобранный — в failed с причиной, «распечатан» ставится только собранным', async () => {
    const { svc, passports } = service([pass('1'), pass('2'), pass('3')]);
    (svc as never as { input: unknown }).input = jest.fn(async (p: { _id: string }) => {
      if (p._id === 'id2') throw new BadRequestException('Рисунок не читается');
      return { p };
    });
    const r = await svc.orderPdf('o1');
    expect(r.count).toBe(2);
    expect(r.failed).toEqual([{ id: 'id2', passportNumber: '2', name: 'Изделие 2', reason: 'Рисунок не читается' }]);
    expect(passports.markIssued).toHaveBeenCalledTimes(2);
    expect(passports.markIssued).not.toHaveBeenCalledWith('id2');
  });

  it('все не собрались — 400 с перечнем причин и списком failed', async () => {
    const { svc } = service([pass('1')]);
    (svc as never as { input: unknown }).input = jest.fn(async () => { throw new Error('нет файла'); });
    await expect(svc.orderPdf('o1')).rejects.toMatchObject({ response: { failed: [expect.objectContaining({ reason: 'нет файла' })] } });
  });

  it('failReason: берёт русский текст исключения Nest, обрезает длинное', () => {
    expect(failReason(new BadRequestException('Не хватает рисунка'))).toBe('Не хватает рисунка');
    expect(failReason(new Error('x'.repeat(500))).length).toBe(200);
    expect(failReason(null)).toBe('не удалось собрать');
  });
});
