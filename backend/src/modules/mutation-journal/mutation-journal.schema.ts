import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MutationJournalDocument = HydratedDocument<MutationJournal>;

export const MUTATION_STATUSES = [
  'proposed',
  'applied',
  'undone',
  'cancelled',
  'expired',
] as const;
export type MutationStatus = (typeof MUTATION_STATUSES)[number];

export const MUTATION_KINDS = [
  'material.create',
  'material.update',
  'product.create',
  'product.update',
  // TZD-ORDER-IMPORT-01 — order import HITL chain.
  'counterparty.create',
  'site.create',
  'order.create',
] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

/**
 * TZD-13 — entity-level mutation journal + propose/confirm.
 * Ring buffer keeps last N applied/undone batches (default 50).
 * Proposals do not mutate SoT until confirm.
 */
@Schema({ softDelete: false,  collection: 'mutation_journal', timestamps: true })
export class MutationJournal {
  @Prop({ required: true, enum: MUTATION_STATUSES, index: true })
  status!: MutationStatus;

  @Prop({ required: true, enum: MUTATION_KINDS, index: true })
  kind!: MutationKind;

  @Prop({ required: true })
  toolName!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;

  @Prop({ required: true, default: 'Material' })
  entityType!: string;

  @Prop({ type: Types.ObjectId, index: true })
  entityId?: Types.ObjectId;

  /** Payload for create/update propose (applied on confirm). */
  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop({ type: Object })
  before?: Record<string, unknown> | null;

  @Prop({ type: Object })
  after?: Record<string, unknown> | null;

  @Prop()
  appliedAt?: Date;

  @Prop()
  undoneAt?: Date;

  @Prop()
  expiresAt?: Date;

  /** TZD-18 — batch idempotency marker (optional; set on propose-batch items). */
  @Prop({ index: true })
  idempotencyKey?: string;
}

export const MutationJournalSchema = SchemaFactory.createForClass(MutationJournal);
MutationJournalSchema.index({ status: 1, createdAt: -1 });
MutationJournalSchema.index({ organizationId: 1, status: 1, appliedAt: -1 });
