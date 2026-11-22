import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import type { RegistryLine } from './passport-registry.service';

@Schema({ collection: 'passporthandovers', timestamps: true, softDelete: false })
export class PassportHandover {
  @Prop({ type: Types.ObjectId, required: true }) orderId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) actorId!: Types.ObjectId;
  @Prop() actorName?: string;
  @Prop({ required: true }) clientUid!: string;
  @Prop({ required: true }) fingerprint!: string;
  @Prop({ required: true }) recipient!: string;
  @Prop({ required: true }) handedOn!: string;
  @Prop({ type: [Object], required: true }) rows!: RegistryLine[];
}
export type PassportHandoverDocument = HydratedDocument<PassportHandover>;
export const PassportHandoverSchema = SchemaFactory.createForClass(PassportHandover);
PassportHandoverSchema.index({ orderId: 1, clientUid: 1 }, { unique: true });
PassportHandoverSchema.index({ orderId: 1, createdAt: -1 });
