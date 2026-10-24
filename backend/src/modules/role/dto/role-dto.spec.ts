import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

/** SK-8a: appSections у роли — только разделы из common/app-sections.ts. */
describe('Role DTO — appSections', () => {
  const errs = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).filter((e) => e.property === 'appSections');

  it('известные разделы и пустой список — проходят', async () => {
    expect(await errs(UpdateRoleDto, { appSections: ['stock', 'requests'] })).toHaveLength(0);
    expect(await errs(UpdateRoleDto, { appSections: [] })).toHaveLength(0);
    expect(await errs(UpdateRoleDto, {})).toHaveLength(0);
  });

  it('чужой раздел — ошибка по-русски', async () => {
    const e = await errs(UpdateRoleDto, { appSections: ['stock', 'hack'] });
    expect(e).toHaveLength(1);
    expect(Object.values(e[0].constraints ?? {}).join(' ')).toMatch(/Неизвестный раздел/);
  });

  it('повтор и не массив — ошибка', async () => {
    expect(await errs(UpdateRoleDto, { appSections: ['stock', 'stock'] })).toHaveLength(1);
    expect(await errs(CreateRoleDto, { name: 'x1', label: 'Икс', permissions: [], appSections: 'stock' })).toHaveLength(1);
  });
});
