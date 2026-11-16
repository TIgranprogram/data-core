import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';

function fixture() {
  const element = new Types.ObjectId();
  const passport = { _id: new Types.ObjectId(), passportCategory: 'TRN', elements: [element], textSnapshot: { sections: [], rules: ['Старый текст'] } };
  const rec = { _id: element, dict: 'passportElements', name: 'Связанный элемент', usageRules: 'Текущий текст' };
  const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
  const coll = { findOne: jest.fn(async () => rec), countDocuments: jest.fn(async () => 1), updateOne };
  const service = Object.create(ProductPassportService.prototype) as ProductPassportService;
  Object.assign(service, {
    findById: jest.fn(async () => ({ toObject: () => passport })),
    connection: { db: { collection: () => coll } },
    buildText: jest.fn(async () => ({ text: { sections: [], rules: [rec.usageRules], refs: { rules: [{ kind: 'element', id: String(element), field: 'usageRules' }] } } })),
  });
  return { service, passport, rec, updateOne };
}

it('C132 старому снимку нужен явный выбор: sources только читает, sourceKey позволяет target', async () => {
  const f = fixture();
  const before = JSON.stringify(f.passport);
  await expect(f.service.promoteSnapshotField(String(f.passport._id), { field: 'rules', index: 0, text: 'Моё' }, true)).rejects.toThrow(ConflictException);
  const { items } = await f.service.snapshotFieldSources(String(f.passport._id), { field: 'rules', index: 0 });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ label: expect.stringContaining('Связанный элемент'), currentText: 'Текущий текст', sourceKey: expect.any(String) });
  const target = await f.service.promoteSnapshotField(String(f.passport._id), { field: 'rules', index: 0, text: 'Моё', sourceKey: items[0].sourceKey }, true);
  expect(target).toMatchObject({ affected: 1, token: expect.any(String) });
  expect(f.updateOne).not.toHaveBeenCalled();
  expect(JSON.stringify(f.passport)).toBe(before);
});

it('C132 sourceKey другой записи и изменившийся текст отклоняются без записи', async () => {
  const f = fixture();
  const { items } = await f.service.snapshotFieldSources(String(f.passport._id), { field: 'rules', index: 0 });
  const body = { field: 'rules', index: 0, text: 'Моё', sourceKey: items[0].sourceKey };
  await expect(f.service.promoteSnapshotField(String(f.passport._id), { ...body, sourceKey: 'чужая запись' })).rejects.toThrow(ConflictException);
  f.rec.usageRules = 'Изменилось после выбора';
  await expect(f.service.promoteSnapshotField(String(f.passport._id), body)).rejects.toThrow(ConflictException);
  expect(f.updateOne).not.toHaveBeenCalled();
});
