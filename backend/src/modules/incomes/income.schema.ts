import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IncomeDocument = HydratedDocument<Income>;

export interface IncomePayment { date: Date; amount: number; method?: string; note?: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  /** КМ2: сопоставление с изделием. auto — предложено, не подтверждено; confirmed — подтверждено; none — «не изделие» (монтаж, доставка). CRM не читает. */
  @Prop({ enum: ['auto', 'confirmed', 'none'] }) matchStatus?: 'auto' | 'confirmed' | 'none';
  @Prop({ type: Date }) matchedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) matchedBy?: Types.ObjectId;
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
  /** Размер — вариант изделия (БЗ-5: варианты по цвету и размеру), рядом с цветом. */
  @Prop({ trim: true }) size?: string;
  @Prop({ min: 0 }) unitPrice?: number;
  /** Доход вручную — важнее qty × unitPrice. */
  @Prop({ min: 0 }) amountManual?: number;
  @Prop({ type: Date, index: true }) shipDate?: Date;
  /** Дата ПОЛНОЙ оплаты (= дата последнего платежа, когда Σ платежей ≥ сумма); вычисляется сервисом из `payments`. */
  @Prop({ type: Date, index: true }) paidDate?: Date;
  /** Платежи по позиции (В-4): дата, сумма, способ (нал / безнал / карта), примечание. CRM коллекцию не читает. */
  @Prop({ type: [{ _id: false, date: { type: Date, required: true }, amount: { type: Number, required: true, min: 0 }, method: { type: String, trim: true }, note: { type: String, trim: true } }], default: undefined })
  payments?: IncomePayment[];
  /** Σ платежей (вычисляется). У старых записей с paidDate без платежей = сумма позиции. */
  @Prop({ default: 0 }) paidAmount?: number;
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
  /** Ключи повторов POST /incomes/:id/payments (clientUid платежа). */
  @Prop({ type: [String], default: undefined }) paymentUids?: string[];
  @Prop() source?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  /** Фото позиции (из Excel «Вид» или добавленные в карточке). */
  @Prop({ type: [Types.ObjectId], default: undefined }) photoIds?: Types.ObjectId[];
  /** Этап 3 заказов: отменённая позиция не удаляется, а остаётся серой строкой с причиной; в суммы, долги и производство не идёт. CRM коллекцию не читает. */
  @Prop({ type: Date, index: true, sparse: true }) cancelledAt?: Date | null;
  @Prop({ trim: true }) cancelReason?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) cancelledBy?: Types.ObjectId;
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const IncomeSchema = SchemaFactory.createForClass(Income);
IncomeSchema.index({ reportDate: 1, companyId: 1 });

/**
 * amount, оплата и reportDate из полей строки (одно правило для сервиса, синхронизации таблиц и отчётов).
 * Есть платежи: paidAmount = Σ, paidDate = дата последнего платежа, когда оплачено полностью (Σ ≥ сумма > 0), иначе пусто.
 * Платежей нет, но есть paidDate (старые записи, таблица): считается оплаченной целиком.
 */
export function incomeDerived(d: { qty?: number | null; unitPrice?: number | null; amountManual?: number | null; shipDate?: Date | null; paidDate?: Date | null; payments?: Array<{ date: Date; amount: number }> | null }) {
  const manual = d.amountManual ?? undefined;
  const calc = d.qty != null && d.unitPrice != null ? r2(d.qty * d.unitPrice) : 0;
  const amount = manual != null ? manual : calc;
  const pays = d.payments ?? [];
  let paidAmount: number, paidDate: Date | undefined;
  if (pays.length) {
    paidAmount = r2(pays.reduce((s, p) => s + p.amount, 0));
    paidDate = amount > 0 && paidAmount >= amount ? new Date(Math.max(...pays.map((p) => p.date.getTime()))) : undefined;
  } else {
    paidDate = d.paidDate ?? undefined;
    paidAmount = paidDate ? amount : 0;
  }
  return { amount, paidAmount, paidDate, reportDate: paidDate ?? d.shipDate ?? undefined };
}

/** Платежи позиции для календаря: свои или (старая запись с paidDate) один платёж на всю сумму. */
export function incomePayments(d: { amount?: number | null; paidDate?: Date | null; payments?: IncomePayment[] | null }): IncomePayment[] {
  if (d.payments?.length) return d.payments;
  return d.paidDate && Number(d.amount) > 0 ? [{ date: d.paidDate, amount: Number(d.amount) }] : [];
}
