import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkTaskDocument = HydratedDocument<WorkTask>;

/** Статусы: ждёт запуска (шаг не начат) → в работе (идёт шаг маршрута) → готово; отменено — снято (причина в cancelReason). */
export const WORK_STATUSES = ['waiting', 'work', 'done', 'cancelled'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** Шаг маршрута в задании — снимок на момент запуска (правка маршрута изделия уже запущенное не меняет). */
export interface WorkStep {
  /** null — общая работа «Изготовление» (у изделия нет маршрута). */
  workTypeId: Types.ObjectId | null;
  name: string;
  /** Часть состава изделия (composition[]._id), к которой относится шаг; необязательно. */
  lineId?: Types.ObjectId;
  note?: string;
}

/** Запись истории движения карточки: с какого шага на какой (null — «Ждёт запуска», длина маршрута — «Готово»). */
export interface WorkMove { at: Date; by?: Types.ObjectId; from: number | null; to: number | null }

/**
 * Задание «В работе»: одна карточка на позицию заказа (`incomeId`), шаги — виды работ маршрута изделия.
 * Только data-core (CRM коллекцию не читает). Цен, часов и сдельной оплаты нет.
 */
@Schema({ timestamps: true, collection: 'worktasks' })
export class WorkTask {
  /** Сквозной номер: код «W-N» (CounterService.nextSeq('WorkTask','W')). */
  @Prop({ type: Number, required: true }) seq!: number;
  @Prop({ type: String, enum: WORK_STATUSES, default: 'work' }) status!: WorkStatus;
  @Prop({ type: Types.ObjectId, required: true }) incomeId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) orderId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) productId?: Types.ObjectId;
  /** Снимок маршрута на момент запуска. */
  @Prop({ type: [Object], default: [] }) route!: WorkStep[];
  /** true — маршрута у изделия не было, шаг один: «Изготовление». */
  @Prop({ type: Boolean, default: false }) generic?: boolean;
  /** Текущий шаг: null — ждёт запуска; 0..n-1 — идёт шаг; n (= длина маршрута) — всё сделано. */
  @Prop({ type: Number, default: null }) stepIndex!: number | null;
  /** Колонка доски текущего шага: id вида работ, `generic` или '' (ждёт / готово). Для фильтра и счётчиков. */
  @Prop({ type: String, default: '' }) stepKey!: string;
  /** Исполнитель — сотрудник (persons); необязательно. */
  @Prop({ type: Types.ObjectId }) assigneeId?: Types.ObjectId;
  @Prop({ trim: true }) note?: string;
  @Prop({ trim: true }) cancelReason?: string;
  @Prop({ type: Date }) startedAt?: Date;
  @Prop({ type: Date }) completedAt?: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) completedBy?: Types.ObjectId;
  @Prop({ type: [Object], default: [] }) moves!: WorkMove[];
  /** Замок «одно открытое задание на позицию»: = incomeId, пока задание жило и не закончено; иначе поля нет. Ставит только сервис. */
  @Prop({ type: Types.ObjectId }) openIncomeId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const WorkTaskSchema = SchemaFactory.createForClass(WorkTask);
WorkTaskSchema.index({ seq: 1 }, { unique: true });
WorkTaskSchema.index({ openIncomeId: 1 }, { unique: true, sparse: true });
WorkTaskSchema.index({ status: 1, stepKey: 1, deletedAt: 1 });
WorkTaskSchema.index({ assigneeId: 1, status: 1 });
WorkTaskSchema.index({ orderId: 1 }, { sparse: true });
WorkTaskSchema.index({ incomeId: 1 });
