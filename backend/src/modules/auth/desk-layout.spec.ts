import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DeskLayoutDto, toDeskLayout } from './dto/desk-layout.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = async (body: unknown) => toDeskLayout(await pipe.transform(body, { type: 'body', metatype: DeskLayoutDto }));
const ORDER = { of: 'salesorders', id: '20-26', lane: 'focus' };
const TASK = { id: '4b13538f-186e-4f0c-8000-81a1fa4544c0', title: 'Сверить срок', done: false };

describe('Данные личного рабочего стола', () => {
  it('сохраняет порядок карточек, задачи и идентификаторы старых заказов', async () => {
    const items = [
      { ...ORDER, tasks: [{ ...TASK, title: '  Сверить срок  ', due: '2028-02-29' }] },
      { of: 'personal', lane: 'waiting', ...TASK, title: 'Ответить заказчику' },
      { of: 'partners', id: 'c:ООО Компания', lane: 'next' },
    ];
    const result = await validate({ version: 2, items });
    expect(result).toEqual({ version: 2, items: [
      { ...ORDER, tasks: [{ ...TASK, due: '2028-02-29' }] },
      items[1],
      items[2],
    ] });
  });

  it.each([
    { version: '1', items: [] },
    { version: 0, items: [], userId: 'another' },
    { version: 0, items: [{ ...ORDER, of: 'arbitrary' }] },
    { version: 0, items: [{ ...ORDER, id: 'https://example.com' }] },
    { version: 0, items: [{ ...ORDER, id: '..' }] },
    { version: 0, items: [{ ...ORDER, of: 'products' }] },
    { version: 0, items: [{ ...ORDER, title: 'Копия исходной записи' }] },
    { version: 0, items: [{ ...ORDER, due: null }] },
    { version: 0, items: [{ ...ORDER, done: false }] },
    { version: 0, items: [ORDER, { ...ORDER, lane: 'next' }] },
    { version: 0, items: [{ ...ORDER, tasks: null }] },
    { version: 0, items: [{ ...ORDER, tasks: [[TASK]] }] },
    { version: 0, items: [{ ...ORDER, tasks: [{ ...TASK, title: '   ' }] }] },
    { version: 0, items: [{ ...ORDER, tasks: [{ ...TASK, due: '2026-02-29' }] }] },
    { version: 0, items: [{ ...ORDER, tasks: [{ ...TASK, price: 1 }] }] },
    { version: 0, items: [{ ...ORDER, tasks: [TASK, { ...TASK, id: TASK.id.toUpperCase() }] }] },
    { version: 0, items: [{ ...ORDER, tasks: Array.from({ length: 13 }, (_, i) => ({ ...TASK, id: TASK.id.slice(0, -2) + String(i).padStart(2, '0') })) }] },
    { version: 0, items: Array.from({ length: 61 }, (_, i) => ({ ...ORDER, id: String(i) })) },
    { version: 0, items: [{ ...ORDER, of: 'personal', id: TASK.id }] },
    { version: 0, items: [{ ...ORDER, of: 'personal', title: TASK.title, done: true }] },
  ])('отклоняет запись вне контракта %#', async (body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
