import { ValidationPipe } from '@nestjs/common';
import { model } from 'mongoose';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleSchema } from './role.schema';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const create = (stockViews?: unknown) => pipe.transform({ label: 'Директор', baseRole: 'director', ...(stockViews === undefined ? {} : { stockViews }) }, { type: 'body', metatype: CreateRoleDto });
const update = (stockViews?: unknown) => pipe.transform(stockViews === undefined ? {} : { stockViews }, { type: 'body', metatype: UpdateRoleDto });

describe('C240 — контракт настройки дополнительных экранов роли', () => {
  it('при отсутствии настройки поле не добавляется, явный пустой список сохраняется', async () => {
    expect((await create()).stockViews).toBeUndefined();
    expect((await update()).stockViews).toBeUndefined();
    expect((await create([])).stockViews).toEqual([]);
    expect((await update([])).stockViews).toEqual([]);
  });
  it.each([['pipe'], ['sheet'], ['pipe', 'sheet']].map(views => ({ views })))('создание и PATCH принимают $views', async ({ views }) => {
    expect((await create(views)).stockViews).toEqual(views);
    expect((await update(views)).stockViews).toEqual(views);
  });
  it.each([null, 'pipe', false, {}, ['wood'], ['unknown'], ['pipe', 'pipe'], ['pipe', 'sheet', 'pipe']].map(value => ({ value })))('создание и PATCH отклоняют $value', async ({ value }) => {
    await expect(create(value)).rejects.toMatchObject({ status: 400 });
    await expect(update(value)).rejects.toMatchObject({ status: 400 });
  });
  it('Mongoose не добавляет default; различает отсутствие поля и []', () => {
    const RoleModel = model('C240RoleSchema', RoleSchema);
    const role = new RoleModel({ name: 'director', label: 'Директор' });
    expect(role.stockViews).toBeUndefined();
    expect(role.toObject()).not.toHaveProperty('stockViews');
    role.stockViews = [];
    expect(role.toObject().stockViews).toEqual([]);
    expect(role.validateSync()).toBeUndefined();
  });
  it('команда сброса существует только в PATCH и допускает только true без списка', async () => {
    expect(await pipe.transform({ resetStockViews: true }, { type: 'body', metatype: UpdateRoleDto })).toMatchObject({ resetStockViews: true });
    for (const value of [false, null, 'true', 1]) {
      await expect(pipe.transform({ resetStockViews: value }, { type: 'body', metatype: UpdateRoleDto })).rejects.toMatchObject({ status: 400 });
    }
    for (const stockViews of [[], ['pipe'], null]) {
      await expect(pipe.transform({ resetStockViews: true, stockViews }, { type: 'body', metatype: UpdateRoleDto })).rejects.toMatchObject({ status: 400 });
    }
    await expect(pipe.transform({ label: 'Директор', baseRole: 'director', resetStockViews: true }, { type: 'body', metatype: CreateRoleDto })).rejects.toMatchObject({ status: 400 });
  });
});
