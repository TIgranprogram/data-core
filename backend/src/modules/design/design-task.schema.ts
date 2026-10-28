import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ORDER_PRIORITIES, type OrderPriority } from '../../common/text/order-key';

export type DesignTaskDocument = HydratedDocument<DesignTask>;

/** Статусы задачи: на распределении → в работе (нужен исполнитель) → завершена; приостановлена — с причиной. */
export const DESIGN_STATUSES = ['queue', 'work', 'done', 'paused', 'cancelled'] as const; // cancelled — снята (расторжение и т. п.), документации нет; причина в pauseReason
export type DesignStatus = (typeof DESIGN_STATUSES)[number];

/**
 * Задача «Проектирования» (ПРЖ-3): чертежи под позицию заказа (`incomeId`) или свободная задача.
 * Срок и приоритет заказа в задачу НЕ копируются — берутся при выдаче; `manual` — только свои значения
 * (свободная задача или ручная правка). Цен и сумм нет.
 */
@Schema({ timestamps: true, collection: 'designtasks' })
export class DesignTask {
  /** Сквозной номер: код «D-N» (CounterService.nextSeq('DesignTask','D')). */
  @Prop({ type: Number, required: true }) seq!: number;
  @Prop({ type: String, enum: DESIGN_STATUSES, default: 'queue' }) status!: DesignStatus;
  @Prop({ type: Types.ObjectId }) orderId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) incomeId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) productId?: Types.ObjectId;
  /** Исполнитель — сотрудник (persons). */
  @Prop({ type: Types.ObjectId }) assigneeId?: Types.ObjectId;
  /** Своё название; пусто — собирается из изделия и позиции. */
  @Prop({ trim: true }) title?: string;
  /** Свои срок и приоритет; пусто — берутся из заказа при выдаче. */
  @Prop({ type: { deadline: { type: Date }, priority: { type: String, enum: ORDER_PRIORITIES } }, _id: false })
  manual?: { deadline?: Date; priority?: OrderPriority };
  @Prop({ trim: true }) pauseReason?: string;
  @Prop({ trim: true }) note?: string;
  @Prop({ type: Date }) completedAt?: Date;
  @Prop({ type: Types.ObjectId }) completedBy?: Types.ObjectId;
  /**
   * Замок «одна открытая задача на позицию»: = incomeId, пока задача жива и не завершена; иначе поля нет.
   * Уникальный sparse-индекс (partial с $ne/$in в Mongo 4.4 недоступен). Ставит только сервис.
   */
  @Prop({ type: Types.ObjectId }) openIncomeId?: Types.ObjectId;
  /** Фото задачи (photos; загрузка — POST /api/photos/upload, привязка — POST /design-tasks/:id/photos). */
  @Prop({ type: [Types.ObjectId], default: undefined }) photoIds?: Types.ObjectId[];
  /** Значения стикеров: { <_id стикера>: число | id состояния }; пишется точечно ($set stickers.<id>). */
  @Prop({ type: Object }) stickers?: Record<string, number | string>;
  /** Что изготовить (разбор строки ЗНП из YouGile или ручная правка); необязательно. */
  @Prop({ type: Object }) spec?: { qty?: string; unit?: string; size?: string; mount?: string; cover?: string; ral?: string; extra?: string; raw?: string };
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const DesignTaskSchema = SchemaFactory.createForClass(DesignTask);
DesignTaskSchema.index({ seq: 1 }, { unique: true });
DesignTaskSchema.index({ openIncomeId: 1 }, { unique: true, sparse: true });
DesignTaskSchema.index({ status: 1, deletedAt: 1 });
DesignTaskSchema.index({ assigneeId: 1, status: 1 });
DesignTaskSchema.index({ orderId: 1 }, { sparse: true });
