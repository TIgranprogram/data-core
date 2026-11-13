import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';
import * as fp from './passport-from-product';

/** Предпросмотр PDF по изделию: собирает черновик в памяти, ничего не пишет в паспорта. */
describe('ProductPassportService.previewDoc', () => {
  const pid = new Types.ObjectId();
  const write = jest.fn();
  const make = (prod: unknown) => {
    const svc = Object.create(ProductPassportService.prototype) as Record<string, unknown>;
    svc.connection = { db: {}, collection: () => ({ findOne: async () => prod, insertOne: write, updateOne: write }) };
    svc.model = { create: write, updateOne: write, findOneAndUpdate: write };
    return svc as unknown as ProductPassportService;
  };
  beforeEach(() => { write.mockClear(); jest.spyOn(fp, 'productPatch').mockResolvedValue({ name: 'Турник' }); });

  it('нет категории — 400 по-русски, записи нет', async () => {
    const svc = make({ _id: pid });
    (svc as unknown as Record<string, unknown>).buildText = jest.fn().mockResolvedValue(null);
    await expect(svc.previewDoc(String(pid))).rejects.toThrow(BadRequestException);
    await expect(svc.previewDoc(String(pid))).rejects.toThrow(/тип паспорта/);
    expect(write).not.toHaveBeenCalled();
  });
  it('изделия нет — 404', async () => {
    await expect(make(null).previewDoc(String(pid))).rejects.toThrow(NotFoundException);
  });
  it('есть категория — черновик с текстом, без номера, без записи', async () => {
    const svc = make({ _id: pid });
    (svc as unknown as Record<string, unknown>).buildText = jest.fn().mockResolvedValue({ text: { sections: [{}] } });
    const d = await svc.previewDoc(String(pid));
    expect(d.status).toBe('draft');
    expect(d.passportNumber).toBe('');
    expect((d.textSnapshot as { sections: unknown[] }).sections).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });
});
