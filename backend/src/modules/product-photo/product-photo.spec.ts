import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { checkPurposeKind, purposeFilter } from './product-photo-purpose';
import { ProductPhotoService } from './product-photo.service';

describe('фото изделия: purpose / kind', () => {
  it('без параметра — витрина и записи без поля', () => {
    expect(purposeFilter()).toEqual({ $or: [{ purpose: { $exists: false } }, { purpose: null }, { purpose: 'showcase' }] });
    expect(purposeFilter('passport')).toEqual({ purpose: 'passport' });
    expect(() => purposeFilter('xx')).toThrow(BadRequestException);
  });
  it('kind — только для passport и из списка видов', () => {
    expect(() => checkPurposeKind('passport', 'dimensions')).not.toThrow();
    expect(() => checkPurposeKind('passport')).toThrow(/вид рисунка/);
    expect(() => checkPurposeKind('passport', 'nope')).toThrow(/Неизвестный вид/);
    expect(() => checkPurposeKind('showcase', 'overview')).toThrow(/только для фото/);
    expect(() => checkPurposeKind(undefined, undefined)).not.toThrow();
  });

  const make = () => {
    const calls: Record<string, unknown[]> = { find: [], create: [], updateMany: [] };
    const chain = { populate: () => chain, sort: () => chain, exec: async () => [] };
    const model = {
      find: (f: unknown) => { calls.find.push(f); return chain; },
      create: async (d: unknown) => { calls.create.push(d); return d; },
      updateMany: (f: unknown) => { calls.updateMany.push(f); return { exec: async () => undefined }; },
    };
    return { svc: new ProductPhotoService(model as never), calls };
  };
  const pid = String(new Types.ObjectId());

  it('GET без purpose не отдаёт рисунки паспорта; удалённые скрыты', async () => {
    const { svc, calls } = make();
    await svc.findByProduct(pid);
    expect(calls.find[0]).toMatchObject({ deletedAt: null, $or: expect.any(Array) });
    await svc.findByProduct(pid, 'passport');
    expect(calls.find[1]).toMatchObject({ purpose: 'passport', deletedAt: null });
  });
  it('загрузка passport + kind пишет поля, не делает фото главным и не сбрасывает главное витрины', async () => {
    const { svc, calls } = make();
    await svc.upsert({ productId: pid, photoId: String(new Types.ObjectId()), purpose: 'passport', kind: 'dimensions', isMain: true });
    expect(calls.create[0]).toMatchObject({ purpose: 'passport', kind: 'dimensions', isMain: false });
    expect(calls.updateMany).toHaveLength(0);
  });
  it('витринное фото пишется как раньше — без purpose и kind', async () => {
    const { svc, calls } = make();
    await svc.upsert({ productId: pid, isMain: true });
    expect(calls.create[0]).not.toHaveProperty('purpose');
    expect(calls.create[0]).not.toHaveProperty('kind');
    expect(calls.updateMany).toHaveLength(1);
  });
  it('passport без kind — 400', async () => {
    await expect(make().svc.upsert({ productId: pid, purpose: 'passport' })).rejects.toThrow(BadRequestException);
  });
});
