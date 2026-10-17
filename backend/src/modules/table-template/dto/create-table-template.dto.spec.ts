import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTableTemplateDto } from './create-table-template.dto';

const BASE = {
  name: 'Вид таблицы',
  columns: [{ key: 'name', label: 'Наименование' }],
};

/**
 * TZ-NX-SORTORDER-EMPTY-MIN — live evidence: `POST /api/table-templates`
 * with `sortOrder: ""` (a cleared "Порядок" field, sent by the FE's
 * `app-pi-input[type="number"]` CVA which always writes back a string)
 * returned 400 "sortOrder: Значение слишком мало; sortOrder: Должно быть
 * числом" instead of treating the field as unset. `@Transform` normalizes
 * `''`/`null`/`NaN` to `undefined` before `@IsOptional()` runs.
 */
describe('CreateTableTemplateDto sortOrder (TZ-NX-SORTORDER-EMPTY-MIN)', () => {
  it('accepts an empty string sortOrder as if it were omitted (belt-and-braces for a non-updated client)', async () => {
    const dto = plainToInstance(CreateTableTemplateDto, { ...BASE, sortOrder: '' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortOrder')).toBe(false);
    expect(dto.sortOrder).toBeUndefined();
  });

  it('accepts a missing sortOrder (the normal, fixed-FE case)', async () => {
    const dto = plainToInstance(CreateTableTemplateDto, { ...BASE });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts an explicit 0', async () => {
    const dto = plainToInstance(CreateTableTemplateDto, { ...BASE, sortOrder: 0 });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.sortOrder).toBe(0);
  });

  it('still rejects a real negative sortOrder (Min(0) is not weakened)', async () => {
    const dto = plainToInstance(CreateTableTemplateDto, { ...BASE, sortOrder: -1 });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortOrder')).toBe(true);
  });

  it('still rejects a non-numeric, non-empty sortOrder', async () => {
    const dto = plainToInstance(CreateTableTemplateDto, { ...BASE, sortOrder: 'abc' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortOrder')).toBe(true);
  });
});
