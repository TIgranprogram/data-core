import { BadRequestException } from '@nestjs/common';
import { checkLine, isServiceWorkType } from './line-type';

const run = (type: Parameters<typeof checkLine>[0], f: Record<string, unknown>, wt?: string | null) => () => checkLine(type, (k) => f[k], wt);

describe('типы позиций заказа', () => {
  it('без типа (старые позиции) — не проверяется', () => {
    expect(run(undefined, {})).not.toThrow();
  });

  it('новое изделие: нужны название, количество, цена > 0 и нет изделия', () => {
    expect(run('new_product', { title: 'Трибуна', qty: 2, unitPrice: 1000 })).not.toThrow();
    expect(run('new_product', { title: 'Трибуна', qty: 2 })).toThrow('цену');
    expect(run('new_product', { title: 'Трибуна', qty: 2, unitPrice: 0 })).toThrow(BadRequestException);
    expect(run('new_product', { title: 'Трибуна', unitPrice: 5 })).toThrow('количество');
    expect(run('new_product', { title: 'Трибуна', qty: 1, unitPrice: 5, productId: 'x' })).toThrow(BadRequestException);
    expect(run('new_product', { title: ' ', qty: 1, unitPrice: 5 })).toThrow('наименование');
  });

  it('услуга: только Доставка/Монтаж из справочника и цена > 0', () => {
    expect(run('service', { title: 'Доставка', workTypeId: 'w', unitPrice: 500 }, 'Доставка')).not.toThrow();
    expect(run('service', { title: 'Монтаж', workTypeId: 'w', unitPrice: 500 }, ' монтаж ')).not.toThrow();
    expect(run('service', { title: 'Сварка', workTypeId: 'w', unitPrice: 500 }, 'Сварка')).toThrow('Доставка или Монтаж');
    expect(run('service', { title: 'Доставка', unitPrice: 500 })).toThrow('вид работ');
    expect(run('service', { title: 'Доставка', workTypeId: 'w' }, 'Доставка')).toThrow('цену');
    expect(isServiceWorkType(null)).toBe(false);
  });

  it('изделие: нужен productId', () => {
    expect(run('product', {})).toThrow(BadRequestException);
    expect(run('product', { productId: 'p' })).not.toThrow();
  });
});
