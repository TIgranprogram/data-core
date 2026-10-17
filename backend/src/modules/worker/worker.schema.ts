import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkerDocument = HydratedDocument<Worker>;

/**
 * TZ-WORKERS-301 — единая сущность «Люди/Сотрудники».
 *
 * Worker расширен до единого справочника людей: контактные данные,
 * должность/отдел/разряд, производственные поля (ratePerHour,
 * workTypeIds[]), связи с фирмой (organizationId), поставщиком
 * (supplierId / managerOfSupplierIds), аккаунтом системы (userId) и
 * soft-delete (deletedAt). Поле personId остаётся для обратной
 * совместимости со старыми записями.
 *
 * Person НЕ консолидируется в этой задаче (активно используется
 * Organization.contactPersonId, Counterparty, OrganizationContact, EAV) —
 * консолидация вынесена в SUCCESSOR; Worker расширяется без слома legacy.
 *
 * Email хранится в нижнем регистре (нормализация в service), индекс
 * { organizationId, email } sparse-unique — один email в рамках области.
 */
@Schema({ collection: 'workers', timestamps: true })
export class Worker {
  @Prop({ required: true, index: true })
  lastName!: string;

  @Prop({ required: true })
  firstName!: string;

  @Prop()
  patronymic?: string;

  @Prop()
  grade?: string;

  @Prop({ default: 0 })
  ratePerHour?: number;

  @Prop({ type: [Types.ObjectId], ref: 'WorkType', default: [], index: true })
  workTypeIds!: Types.ObjectId[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop()
  phone?: string;

  @Prop({ type: Types.ObjectId, ref: 'Person', index: true })
  personId?: Types.ObjectId;

  @Prop()
  department?: string;

  // ── TZ-WORKERS-301: расширение до «Людей» ─────────────────────

  /** Email (lowercased в service; sparse-unique в рамках organizationId). */
  @Prop({ required: false, sparse: true, index: true })
  email?: string;

  /** Должность (Менеджер по закупкам, Директор и т.д.). */
  @Prop()
  position?: string;

  /** Фирма-поставщик, к которой привязан человек. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true, sparse: true })
  supplierId?: Types.ObjectId;

  /** Фирмы-поставщики, по которым человек выступает менеджером. */
  @Prop({ type: [Types.ObjectId], ref: 'Organization', default: [] })
  managerOfSupplierIds?: Types.ObjectId[];

  /** Опциональная ссылка на аккаунт системы (пароль/логин живут в User). */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true, sparse: true })
  userId?: Types.ObjectId;

  /** TZ-238: область владения. null = системная/глобальная запись. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  /** Soft delete (counterparty-паттерн: remove() ставит дату). */
  @Prop()
  deletedAt?: Date;

  @Prop()
  notes?: string;

  @Prop({ default: false })
  isSystem?: boolean;
}

export const WorkerSchema = SchemaFactory.createForClass(Worker);
WorkerSchema.index({ lastName: 1, firstName: 1 });
// Email unique в рамках области: { organizationId, email } sparse-unique.
// Записи без email/orgId в индекс не попадают — legacy не ломается.
WorkerSchema.index({ organizationId: 1, email: 1 }, { unique: true, sparse: true });
