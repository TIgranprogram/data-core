import { ValidationPipe } from '@nestjs/common';
import { CreateProductPassportDto } from './create-product-passport.dto';
import { UpdateProductPassportDto } from './update-product-passport.dto';

/** forbidNonWhitelisted (main.ts): textChoices должно проходить валидацию, иначе форма паспорта получит 400. */
describe('textChoices в DTO паспорта', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = (metatype: unknown) => ({ type: 'body' as const, metatype: metatype as never });
  const a = '6ad88933ba6c8597a0843aaa', b = '6ad88933ba6c8597a0843bbb';

  it('создание и правка принимают выбор текстов и null', async () => {
    expect((await pipe.transform({ name: 'Х', textChoices: { [a]: b } }, meta(CreateProductPassportDto))).textChoices).toEqual({ [a]: b });
    expect((await pipe.transform({ textChoices: { [a]: b } }, meta(UpdateProductPassportDto))).textChoices).toEqual({ [a]: b });
    expect((await pipe.transform({ textChoices: null }, meta(UpdateProductPassportDto))).textChoices).toBeNull();
  });
  it('строка вместо объекта — 400; неизвестное поле по-прежнему 400', async () => {
    await expect(pipe.transform({ textChoices: 'x' }, meta(UpdateProductPassportDto))).rejects.toThrow();
    await expect(pipe.transform({ junk: 1 }, meta(UpdateProductPassportDto))).rejects.toThrow();
  });
});
