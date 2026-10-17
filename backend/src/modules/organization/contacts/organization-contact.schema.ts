import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrganizationContactDocument = HydratedDocument<OrganizationContact>;

@Schema({ collection: 'organizationcontacts', timestamps: true })
export class OrganizationContact {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Person', required: true, index: true })
  personId!: Types.ObjectId;

  @Prop({ default: false })
  isPrimary!: boolean;

  @Prop()
  role?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const OrganizationContactSchema = SchemaFactory.createForClass(OrganizationContact);
OrganizationContactSchema.index({ organizationId: 1, personId: 1 }, { unique: true });
