import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleCounterpartyDocument = HydratedDocument<RoleCounterparty>;

@Schema({ collection: 'counterpartyroles', timestamps: true, softDelete: false })
export class RoleCounterparty {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: false })
  isSystem!: boolean;
}

export const RoleCounterpartySchema = SchemaFactory.createForClass(RoleCounterparty);
