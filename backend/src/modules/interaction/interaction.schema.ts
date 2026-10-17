import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InteractionDocument = HydratedDocument<Interaction>;
export type InteractionType = 'call' | 'email' | 'meeting' | 'chat' | 'task' | 'note';

@Schema({ collection: 'interactions', timestamps: true })
export class Interaction {
  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  counterpartyId!: Types.ObjectId;

  @Prop({ required: true, enum: ['call', 'email', 'meeting', 'chat', 'task', 'note'], index: true })
  type!: InteractionType;

  @Prop({ required: true })
  description!: string;

  @Prop()
  direction?: 'inbound' | 'outbound';

  @Prop()
  occurredAt?: Date;

  // Polymorphic reference: any entity (Proposal, Contract, Order, ...)
  @Prop({ type: Types.ObjectId, index: true })
  relatedToId?: Types.ObjectId;

  @Prop()
  relatedToType?: string;

  @Prop()
  outcome?: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const InteractionSchema = SchemaFactory.createForClass(Interaction);
InteractionSchema.index({ counterpartyId: 1, occurredAt: -1 });
