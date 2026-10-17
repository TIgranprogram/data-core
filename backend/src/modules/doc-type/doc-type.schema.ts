import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocTypeDocument = HydratedDocument<DocType>;

@Schema({ softDelete: false,  collection: 'doc_types', timestamps: true })
export class DocType {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop()
  description?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;
}

export const DocTypeSchema = SchemaFactory.createForClass(DocType);
