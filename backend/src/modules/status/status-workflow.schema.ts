import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type Transition = {
  fromStatus: string;
  toStatus: string;
  roles: string[];
};

@Schema({ softDelete: false,  _id: false })
class TransitionSchema {
  @Prop({ required: true })
  fromStatus!: string;

  @Prop({ required: true })
  toStatus!: string;

  @Prop({ type: [String], default: [] })
  roles!: string[];
}

const TransitionSchemaFactory = SchemaFactory.createForClass(TransitionSchema);

export type StatusWorkflowDocument = HydratedDocument<StatusWorkflow>;

@Schema({ softDelete: false,  collection: 'statusworkflows', timestamps: true })
export class StatusWorkflow {
  @Prop({ required: true, index: true })
  entityType!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  statuses!: string[];

  @Prop({ type: [TransitionSchemaFactory], default: [] })
  transitions!: Transition[];

  @Prop({ default: true })
  isActive!: boolean;
}

export const StatusWorkflowSchema = SchemaFactory.createForClass(StatusWorkflow);
StatusWorkflowSchema.index({ entityType: 1, name: 1 }, { unique: true });
