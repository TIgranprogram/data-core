import { BadRequestException } from '@nestjs/common';
import { checkLine } from './line-type';

const run = (type: Parameters<typeof checkLine>[0], f: Record<string, unknown>, ok = false) => () => checkLine(type, (k) => f[k], ok);

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

  it('услуга: нужен serviceId из справочника «Услуги» и цена > 0', () => {
    expect(run('service', { title: 'Доставка', serviceId: 's', unitPrice: 500 }, true)).not.toThrow();
    expect(run('service', { title: 'Аренда', serviceId: 's', unitPrice: 500 }, true)).not.toThrow();
    expect(run('service', { title: 'Доставка', serviceId: 's', unitPrice: 500 }, false)).toThrow('не найдена');
    expect(run('service', { title: 'Доставка', unitPrice: 500 })).toThrow('справочника');
    expect(run('service', { title: 'Доставка', serviceId: 's' }, true)).toThrow('цену');
    expect(run('service', { title: 'Доставка', serviceId: 's', unitPrice: 500, productId: 'p' }, true)).toThrow(BadRequestException);
  });

  it('изделие: нужен productId', () => {
    expect(run('product', {})).toThrow(BadRequestException);
    expect(run('product', { productId: 'p' })).not.toThrow();
  });
});
