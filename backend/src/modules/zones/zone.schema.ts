import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ZoneDocument = HydratedDocument<Zone>;
export type ZoneAssignmentDocument = HydratedDocument<ZoneAssignment>;
export type HandoffDocument = HydratedDocument<Handoff>;

/**
 * Зона ответственности (`zones`, только data-core; CRM не читает). События привязаны к `code` в коде сервера.
 * Базовые (`system`) нельзя удалить, можно переименовать. Удаление — soft.
 */
@Schema({ timestamps: true, collection: 'zones' })
export class Zone {
  @Prop({ type: String, required: true, trim: true }) code!: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 40 }) name!: string;
  @Prop({ type: String, trim: true, maxlength: 300 }) hint?: string;
  @Prop({ type: Number, default: 100 }) order!: number;
  @Prop({ type: Boolean, default: true }) active!: boolean;
  @Prop({ type: Boolean, default: false }) system!: boolean;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}
export const ZoneSchema = SchemaFactory.createForClass(Zone);
ZoneSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

/** История «кто когда отвечал за зону» (`zoneassignments`). Снятие = `to`, запись не удаляется. */
@Schema({ timestamps: true, collection: 'zoneassignments' })
export class ZoneAssignment {
  @Prop({ type: String, required: true }) zoneCode!: string;
  @Prop({ type: Types.ObjectId, required: true }) personId!: Types.ObjectId;
  @Prop({ type: Date, required: true }) from!: Date;
  @Prop({ type: Date, default: null }) to?: Date | null;
  @Prop({ type: Types.ObjectId }) byUserId?: Types.ObjectId;
  @Prop({ type: String, trim: true, maxlength: 300 }) note?: string;
}
export const ZoneAssignmentSchema = SchemaFactory.createForClass(ZoneAssignment);
ZoneAssignmentSchema.index({ personId: 1, to: 1 });
ZoneAssignmentSchema.index({ zoneCode: 1, to: 1 });

/** Передача объекта между людьми (`handoffs`): пишет сервер при каждой смене ответственного. */
@Schema({ timestamps: true, collection: 'handoffs' })
export class Handoff {
  @Prop({ type: String, required: true, enum: ['supplyrequest', 'designtask', 'salesorder', 'passport'] }) entity!: string;
  @Prop({ type: Types.ObjectId, required: true }) entityId!: Types.ObjectId;
  @Prop({ type: String, required: true, enum: ['responsibleId', 'assigneeId'] }) field!: string;
  @Prop({ type: Types.ObjectId }) fromPersonId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) toPersonId?: Types.ObjectId;
  @Prop({ type: Date, required: true }) at!: Date;
  @Prop({ type: Types.ObjectId }) byUserId?: Types.ObjectId;
  @Prop({ type: String, trim: true, maxlength: 300 }) reason?: string;
}
export const HandoffSchema = SchemaFactory.createForClass(Handoff);
HandoffSchema.index({ entity: 1, entityId: 1, at: -1 });
HandoffSchema.index({ toPersonId: 1, at: -1 });
HandoffSchema.index({ fromPersonId: 1, at: -1 });
