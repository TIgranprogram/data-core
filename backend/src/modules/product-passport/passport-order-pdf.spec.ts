import { BadRequestException } from '@nestjs/common';
import { PassportPdfService, failReason } from './passport-pdf.service';

jest.mock('./passport-pdf-v2', () => ({ ...jest.requireActual('./passport-pdf-v2'), renderPassportsPdfV2: jest.fn(async () => Buffer.from('%PDF-test')) }));

/** Р5 (C112): печать заказа — один паспорт не собрался, остальные печатаются, несобранные идут списком с причиной. */
const pass = (n: string) => ({ _id: `id${n}`, passportNumber: n, name: `Изделие ${n}`, textSnapshot: { sections: [{ key: 'a' }] } });

function service(items: unknown[]) {
  const passports = { issuedOfOrder: jest.fn(async () => ({ items, orderNo: '77' })), markIssued: jest.fn(async () => undefined) };
  const svc = new PassportPdfService(passports as never, {} as never, {} as never);
  return { svc, passports };
}

describe('Р5: печать заказа при сбое одного паспорта', () => {
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
