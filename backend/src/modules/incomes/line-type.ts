import { BadRequestException } from '@nestjs/common';

/** Тип позиции заказа (ORDER-LINES): изделие / заявка на новое изделие / услуга. */
export const LINE_TYPES = ['product', 'new_product', 'service'] as const;
export type LineType = (typeof LINE_TYPES)[number];

const positive = (v: unknown) => Number(v) > 0;

/**
 * Обязательные поля позиции по типу (только когда тип задан — старые позиции без `lineType` не проверяются).
 * `val(k)` — итоговое значение поля (новое из формы, иначе прежнее).
 * Услуга — из справочника «Услуги» (`dict_values` / `services`), не из «Видов работ».
 * `serviceOk` — запись найдена в справочнике (проверяет сервис до вызова).
 */
export function checkLine(type: LineType | undefined, val: (k: string) => unknown, serviceOk = false): void {
  if (!type) return;
  const title = String(val('title') ?? '').trim();
  if (type === 'product') {
    if (!val('productId')) throw new BadRequestException('Выберите изделие из «Продукции»');
    return;
  }
  if (!title) throw new BadRequestException('Укажите наименование');
  if (type === 'new_product') {
    if (val('productId')) throw new BadRequestException('У нового изделия не может быть выбранного изделия');
    if (!positive(val('qty'))) throw new BadRequestException('Новое изделие: укажите количество');
    if (!positive(val('unitPrice'))) throw new BadRequestException('Новое изделие: укажите цену');
    return;
  }
  if (!val('serviceId')) throw new BadRequestException('Услуга: выберите из справочника «Услуги»');
  if (!serviceOk) throw new BadRequestException('Услуга не найдена в справочнике «Услуги»');
  if (val('productId')) throw new BadRequestException('У услуги не может быть изделия');
  if (!positive(val('unitPrice'))) throw new BadRequestException('Услуга: укажите цену');
}

/** Поля формы, изменение которых требует перепроверки типа позиции. */
export const LINE_CHECK_FIELDS = ['lineType', 'serviceId', 'productId', 'unitPrice', 'qty', 'title'];
