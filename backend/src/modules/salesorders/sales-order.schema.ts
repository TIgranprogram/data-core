import { LegalBundleDto } from '../../common/legal/legal.dto';
import { LegalBundleSchema, LegalHistorySchema, LegalReceiptSchema } from '../../common/legal/legal.schema';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ORDER_PRIORITIES, ORDER_STAGES, type OrderPriority, type OrderStage } from '../../common/text/order-key';

export type SalesOrderDocument = HydratedDocument<SalesOrder>;

/**
 * Заказ заказчика — ШАПКА (TASKS З.1). Позиции — строки `incomes` с `orderId` (там же суммы и оплаты).
 * Своя коллекция data-core: имя `orders` занято CRM kppdf — её не трогаем.
 * Поля шапки (orderNo, customer, companyId, paymentForm, shipDate) продублированы в позициях как кэш
 * для листа «Заказы» и денег; истина — шапка, правка шапки обновляет позиции.
 */
@Schema({ timestamps: true, collection: 'salesorders' })
export class SalesOrder {
  /** C170: барьер смены живости шапки с выпуском/выбором паспорта. */
  @Prop({ type: Number, default: undefined }) passportGuard?: number;
  @Prop({type:Types.ObjectId, ref:'Organization'}) counterpartyId?: Types.ObjectId;
  @Prop({type:LegalBundleSchema, default:undefined}) legal?: LegalBundleDto;
  @Prop({type:Number}) legalVersion?: number;
  @Prop({type:[LegalReceiptSchema], default:undefined}) legalReceipts?: unknown[];
  @Prop({type:[LegalHistorySchema], default:undefined}) legalHistory?: unknown[];
  @Prop() intakeUid?: string;
  @Prop() intakeKey?: string;
  @Prop() intakeHash?: string;
  /** № заказа как в документе («34», «110-П», «10 Новороссийск»). */
  @Prop({ trim: true, index: true }) orderNo?: string;
  /** Наша компания (organizations.isOurCompany: СИЮ / ССЮ). Пусто — компания не наша/не определена. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true }) companyId?: Types.ObjectId;
  /** Заказчик — текстом (карточки контрагентов — позже). */
  @Prop({ trim: true, index: true }) customer?: string;
  /** Предмет заказа/контракта. */
  @Prop({ trim: true }) title?: string;
  /** Форма оплаты: б/р, б/р 30%, нал… */
  @Prop({ trim: true }) paymentForm?: string;
  @Prop({ trim: true }) contractNo?: string;
  /** № на производство («21-26» = порядковый-ГГ). В кэш позиций не копируется. */
  @Prop({ trim: true, index: true }) productionNo?: string;
  /** Когда договор вошёл в заказ (установлен/сменён productionNo): порядок договоров и сквозная нумерация позиций. Нет — createdAt. */
  @Prop({ type: Date }) productionAddedAt?: Date;
  @Prop({ type: Date }) contractDate?: Date;
  @Prop({ type: Date, index: true }) shipDate?: Date;
  /** Срок изготовления. */
  @Prop({ type: Date, index: true }) productionDeadline?: Date;
  /** Окончание поставки (и установки). */
  @Prop({ type: Date }) deliveryDeadline?: Date;
  @Prop({ type: String, enum: ORDER_STAGES, default: 'new', index: true }) stage!: OrderStage;
  @Prop({ trim: true }) notes?: string;
  /** Приоритет заказа (ПРЖ-3): нет = обычный. Подставляется в задачи «Проектирования»; в кэш позиций не копируется. */
  @Prop({ type: String, enum: ORDER_PRIORITIES, index: true }) priority?: OrderPriority;

  /** ЗО-5: ответственный менеджер договора — сотрудник (persons). Смена пишется в handoffs. */
  @Prop({ type: Types.ObjectId, sparse: true }) responsibleId?: Types.ObjectId;

  /**
   * Ключ «компания|номер» (order-key.ts). Ставится при создании и НЕ меняется при правке номера —
   * по нему лист «Заказы» и импорт Excel находят шапку без дублей.
   */
  @Prop({ unique: true, sparse: true }) importKey?: string;
  /** Повтор создания с тем же ключом клиента не создаёт дубль. */
  @Prop({ index: true, sparse: true }) clientUid?: string;
  /** Исходное КП (этап 2). */
  @Prop({ type: Types.ObjectId, sparse: true }) offerId?: Types.ObjectId;
  @Prop({ trim: true }) offerNo?: string;
  /** Откуда шапка: google-sheets / import-xlsx / пусто — заведена в приложении. */
  @Prop() source?: string;
  /** Шапку правили в приложении — лист «Заказы» берёт поля шапки из неё, а не из своих строк. */
  @Prop() editedInApp?: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const SalesOrderSchema = SchemaFactory.createForClass(SalesOrder);
SalesOrderSchema.index({ stage: 1, shipDate: -1 });
SalesOrderSchema.index({ productionNo: 1, deletedAt: 1 });

SalesOrderSchema.index({intakeUid:1},{name:'c164_sales_intake_uid',unique:true,partialFilterExpression:{intakeUid:{$type:'string'}}});
SalesOrderSchema.index({intakeKey:1},{name:'c164_sales_intake_key',unique:true,partialFilterExpression:{intakeKey:{$type:'string'}}});
