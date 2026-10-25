import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { skuPrefixError } from './showcase-sku';
import { ShowcaseService } from './showcase.service';

/** Замок префикса артикула: у группы с номером вручную правятся только две последние цифры. */
describe('skuPrefixError', () => {
  it('номер группы + две цифры — можно', () => expect(skuPrefixError('12', '1280')).toBeNull());
  it.each(['1380', '128', '12800', '12аб', 'ЗК-1'])('%s — нельзя', (sku) => expect(skuPrefixError('12', sku)).toContain('Номер группы 12 менять нельзя'));
});

describe('ShowcaseService.update: замок префикса', () => {
  const gid = new Types.ObjectId(); const pid = new Types.ObjectId();
  const mk = (cur: { sku: string; categoryId: Types.ObjectId | null }, groupNo: string | null) => {
    const db = { collection: (c: string) => ({
      findOne: async () => (c === 'categories' ? { _id: gid, name: 'Скамьи', groupNo } : c === 'products' ? { _id: pid, ...cur } : null),
    }) };
    return new ShowcaseService({ db } as never, {} as never);
  };

  it('чужой префикс — 400 с понятным текстом', async () => {
    const s = mk({ sku: '1201', categoryId: gid }, '12');
    await expect(s.update(String(pid), { sku: '1301' })).rejects.toThrow(BadRequestException);
    await expect(s.update(String(pid), { sku: '1301' })).rejects.toThrow('Номер группы 12 менять нельзя — правьте только последние две цифры');
  });

  it('тот же артикул (форма шлёт его целиком) замок не трогает, даже «ЗК-1» в группе с номером', async () => {
    const s = mk({ sku: 'ЗК-1', categoryId: gid }, '12');
    // дальше замка идёт обычная запись — тут её нет, важно лишь что не 400 от замка
    await expect(s.update(String(pid), { sku: 'зк-1' })).rejects.not.toThrow('Номер группы');
  });

  it('у группы нет номера — замка нет', async () => {
    const s = mk({ sku: 'ЗК-1', categoryId: gid }, null);
    await expect(s.update(String(pid), { sku: 'ЗК-2' })).rejects.not.toThrow('Номер группы');
  });
});
