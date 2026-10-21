import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IncomeDocument = HydratedDocument<Income>;

/**
 * Доход = строка заказа (лист «Заказы» Google-таблицы): что отгрузили, кому, на сколько и когда оплатили.
 * Своя коллекция data-core (CRM `orders` не подходит: требует товар каталога и контрагента). Это и есть
 * позиция заказа заказчика: шапка — `salesorders` (orderId), поля шапки здесь — кэш (TASKS З.1–З.2).
 * Вычисляемые поля хранятся (для фильтров и сортировки) и пересчитываются сервисом при каждой записи:
 *   amount = amountManual ?? qty × unitPrice;  reportDate = paidDate ?? shipDate.
 */
@Schema({ timestamps: true, collection: 'incomes' })
export class Income {
  /** Шапка заказа (salesorders). Истина для orderNo, customer, companyId, paymentForm, shipDate — она; здесь кэш. */
  @Prop({ type: Types.ObjectId, ref: 'SalesOrder', index: true }) orderId?: Types.ObjectId;
  /** № позиции в заказе (столбец «№» заказ-наряда). */
  /** Изделие из «Продукции» (необязательно, TASKS БЗ-5). Правка изделия описание позиции не меняет — позиция остаётся как в договоре. */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true, sparse: true }) productId?: Types.ObjectId;
  @Prop() lineNo?: number;
  /** № заказа (как в таблице; строка — бывают «34/2»). */
  @Prop({ trim: true, index: true }) orderNo?: string;
  /** Заказчик — текстом (карточки контрагентов — фаза 4, тогда появится customerId). */
  @Prop({ trim: true, index: true }) customer?: string;
  /** Наша компания (organizations с isOurCompany: СИЮ / ССЮ) — как companyId у заявок снабжения. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true }) companyId?: Types.ObjectId;
  /** Форма оплаты: б/р, нал, … */
  @Prop({ trim: true }) paymentForm?: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop({ min: 0 }) qty?: number;
  @Prop({ trim: true }) unit?: string;
  /** «Вид» и «Цвет» с листа «Заказы». */
  @Prop({ trim: true }) kind?: string;
  @Prop({ trim: true }) color?: string;
  @Prop({ min: 0 }) unitPrice?: number;
  /** Доход вручную — важнее qty × unitPrice. */
  @Prop({ min: 0 }) amountManual?: number;
  @Prop({ type: Date, index: true }) shipDate?: Date;
  @Prop({ type: Date, index: true }) paidDate?: Date;
  @Prop({ trim: true }) notes?: string;

  /** Вычисляемые (сервис): сумма дохода и дата, на которую он ложится в календарь. */
  @Prop({ default: 0 }) amount!: number;
  @Prop({ type: Date, index: true }) reportDate?: Date;

  /** Ключ импорта Excel-заказов «компания|номер|наименование+ед.» (scripts/import-orders-xlsx.js). */
  @Prop({ index: true, sparse: true }) importKey?: string;
  /** Удалена вместе с заказом — восстанавливается вместе с ним. */
  @Prop() deletedWithOrder?: boolean;
  /** Повтор создания с тем же ключом не создаёт дубль. */
  @Prop({ index: true, sparse: true }) clientUid?: string;
  /** Синхронизация Google-таблиц (как у заявок): откуда строка, отпечаток; editedInApp — таблица больше не трогает. */
  @Prop({ index: true, sparse: true }) sheetSource?: string;
  @Prop() sheetKey?: string;
  @Prop() syncHash?: string;
  @Prop() editedInApp?: boolean;
  @Prop() source?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  /** Фото позиции (из Excel «Вид» или добавленные в карточке). */
  @Prop({ type: [Types.ObjectId], default: undefined }) photoIds?: Types.ObjectId[];
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const IncomeSchema = SchemaFactory.createForClass(Income);
IncomeSchema.index({ reportDate: 1, companyId: 1 });

/** amount и reportDate из полей строки (одно правило для сервиса, синхронизации таблиц и отчётов). */
export function incomeDerived(d: { qty?: number | null; unitPrice?: number | null; amountManual?: number | null; shipDate?: Date | null; paidDate?: Date | null }) {
  const manual = d.amountManual ?? undefined;
  const calc = d.qty != null && d.unitPrice != null ? Math.round(d.qty * d.unitPrice * 100) / 100 : 0;
  return { amount: manual != null ? manual : calc, reportDate: d.paidDate ?? d.shipDate ?? undefined };
}
