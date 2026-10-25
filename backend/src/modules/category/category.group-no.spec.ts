import { BadRequestException, ConflictException } from '@nestjs/common';
import { CategoryService } from './category.service';

describe('CategoryService.checkGroupNo (номер группы изделий)', () => {
  const make = (dup: unknown) => {
    const q = { select: () => q, lean: async () => dup };
    const model: any = { findOne: jest.fn(() => q) };
    return { model, check: (...a: unknown[]) => (new CategoryService(model) as any).checkGroupNo(...a) };
  };
  const pid = '507f1f77bcf86cd799439011', self = '507f1f77bcf86cd799439012';

  it('undefined — не меняем; пустая строка — снимаем (null)', async () => {
    const { check, model } = make(null);
    expect(await check(undefined, 'product', pid)).toBeUndefined();
    expect(await check('  ', 'material', null)).toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('не группа изделий (type != product или нет родителя) → 400', async () => {
    const { check } = make(null);
    await expect(check('34', 'material', pid)).rejects.toBeInstanceOf(BadRequestException);
    await expect(check('34', 'product', null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('занятый номер → 409; свою группу при поиске дубля исключает; свободный — trim', async () => {
    await expect(make({ name: 'Скамьи' }).check('34', 'product', pid, self)).rejects.toBeInstanceOf(ConflictException);
    const { check, model } = make(null);
    expect(await check(' 34 ', 'product', pid, self)).toBe('34');
    expect(model.findOne.mock.calls[0][0]).toMatchObject({ groupNo: '34', deletedAt: null, _id: { $ne: expect.anything() } });
  });
});
