import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

const BASE = {
  name: 'Модули сборки',
  slug: 'assembly-modules',
  skuPrefix: 'MOD',
};

/** TZ-NX-REG-CATEGORIES-CRUD — `type` gains `module` alongside material/product/general. */
describe('CreateCategoryDto type validation', () => {
  it('accepts type=module', async () => {
    const dto = plainToInstance(CreateCategoryDto, { ...BASE, type: 'module' });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('still accepts the pre-existing material/product/general types', async () => {
    for (const type of ['material', 'product', 'general']) {
      const dto = plainToInstance(CreateCategoryDto, { ...BASE, type });
      await expect(validate(dto)).resolves.toEqual([]);
    }
  });

  it('rejects an unknown type', async () => {
    const dto = plainToInstance(CreateCategoryDto, { ...BASE, type: 'nonsense' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'type')).toBe(true);
  });
});
