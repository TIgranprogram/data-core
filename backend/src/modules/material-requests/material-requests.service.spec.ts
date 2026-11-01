import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateMaterialRequestDto } from './dto';
import { scopeFilter } from './material-requests.service';

describe('material-requests', () => {
  it('весь склад — без ограничений', () => expect(scopeFilter(null)).toEqual({}));
  it('свои склады и заявки без склада', () => {
    const id = new Types.ObjectId().toString();
    const f = scopeFilter({ zones: [{ id }], categoryIds: [], noCategory: false } as never) as { $or: unknown[] };
    expect(f.$or).toHaveLength(3);
  });
  it('DTO: пустой текст и отрицательное количество отклоняются', async () => {
    expect(await validate(plainToInstance(CreateMaterialRequestDto, { text: '' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateMaterialRequestDto, { text: 'Болт М8', qty: 10 }))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateMaterialRequestDto, { text: 'x', qty: -1 }))).not.toHaveLength(0);
  });
});
