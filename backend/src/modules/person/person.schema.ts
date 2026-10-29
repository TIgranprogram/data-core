import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PersonDocument = HydratedDocument<Person>;

@Schema({ collection: 'persons', timestamps: true })
export class Person {
  /** TZ-PARTY-305: фамилия необязательна (имя+телефон достаточно). */
  @Prop({ index: true })
  lastName?: string;

  @Prop({ required: true })
  firstName!: string;

  @Prop()
  patronymic?: string;

  @Prop()
  phone?: string;

  @Prop({ index: true })
  email?: string;

  @Prop()
  position?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  // ── Поля data-core (2026-10-21, «Справочники» → «Сотрудники»): добавочные, CRM их не пишет ──
  /** Вид работ (worktypes): сварщик, маляр… */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  workTypeId?: Types.ObjectId;

  /** Несколько видов работ (сварщик и маляр). Необязательно; старое `workTypeId` пишется синхронно первым значением, нет нового — читать старое. CRM не читает. */
  @Prop({ type: [Types.ObjectId], default: undefined })
  workTypeIds?: Types.ObjectId[];

  /** active — работает, vacation — в отпуске, fired — уволен. */
  @Prop()
  status?: string;

  /** month — оклад, hour — почасовая. */
  @Prop()
  salaryKind?: string;

  /** Ставка (₽ в месяц или за час) — денежное поле, скрыто от не-денежных ролей. */
  @Prop()
  salaryRate?: number;

  /** Дата рождения (полночь UTC). */
  @Prop({ type: Date, default: null })
  birthDate?: Date | null;

  /** График выплат (dict_values, dict = payoutSchedules). */
  @Prop({ type: Types.ObjectId, sparse: true })
  payoutScheduleId?: Types.ObjectId;

  /** Наша компания, которая платит зарплату (organizations.isOurCompany) — ФОТ по компаниям; пишет /api/payroll/people/:id. */
  @Prop({ type: Types.ObjectId, sparse: true })
  companyId?: Types.ObjectId;

  /** Вход в приложение (users._id): связь «сотрудник ↔ вход» (ЗО-1). Один вход — один сотрудник; CRM не читает. */
  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  /** Текущие зоны ответственности (коды); истина — zoneassignments (ЗО-2). */
  @Prop({ type: [String], default: undefined })
  zoneCodes?: string[];
}

export const PersonSchema = SchemaFactory.createForClass(Person);
PersonSchema.index({ lastName: 1, firstName: 1, patronymic: 1 });
/** TZ-PARTY-305: дубли телефона запрещены (sparse — null/undefined пропускаются). */
PersonSchema.index({ phone: 1 }, { unique: true, sparse: true });
/** ЗО-1: один вход — один сотрудник (Mongo 4.4: partial только с $type). */
PersonSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
