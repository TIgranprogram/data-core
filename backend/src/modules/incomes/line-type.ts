import { BadRequestException } from '@nestjs/common';
import { normText } from '../../common/text/norm-text';

/** Тип позиции заказа (ORDER-LINES): изделие / заявка на новое изделие / услуга. */
export const LINE_TYPES = ['product', 'new_product', 'service'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Виды работ, которые можно ставить услугой в заказ (записи справочника «Виды работ»). */
export const SERVICE_WORK_TYPES = ['доставка', 'монтаж'];
export const isServiceWorkType = (name: unknown): boolean => SERVICE_WORK_TYPES.includes(normText(String(name ?? '')));

const positive = (v: unknown) => Number(v) > 0;

/**
 * Обязательные поля позиции по типу (только когда тип задан — старые позиции без `lineType` не проверяются).
 * `val(k)` — итоговое значение поля (новое из формы, иначе прежнее). `workTypeName` — имя вида работ из справочника.
 */
export function checkLine(type: LineType | undefined, val: (k: string) => unknown, workTypeName?: string | null): void {
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
  if (!val('workTypeId')) throw new BadRequestException('Услуга: выберите вид работ — Доставка или Монтаж');
  if (!isServiceWorkType(workTypeName)) throw new BadRequestException('Услуга — только Доставка или Монтаж');
  if (val('productId')) throw new BadRequestException('У услуги не может быть изделия');
  if (!positive(val('unitPrice'))) throw new BadRequestException('Услуга: укажите цену');
}

/** Поля формы, изменение которых требует перепроверки типа позиции. */
export const LINE_CHECK_FIELDS = ['lineType', 'workTypeId', 'productId', 'unitPrice', 'qty', 'title'];
