import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class DocTableColumn {
  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ default: 100 })
  width!: number;
}

const DocTableColumnSchema = SchemaFactory.createForClass(DocTableColumn);

export type DocumentTableTypeDocument = HydratedDocument<DocumentTableType>;

@Schema({ collection: 'document_table_types', timestamps: true })
export class DocumentTableType {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop()
  label?: string;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'DocType', index: true })
  docType?: Types.ObjectId;

  @Prop({ type: [DocTableColumnSchema], default: [] })
  columns!: DocTableColumn[];

  @Prop()
  dataSource?: string; // 'products' | 'orders' | 'proposals' | ...

  @Prop()
  productKind?: string;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: 12 })
  fontSize!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const DocumentTableTypeSchema = SchemaFactory.createForClass(DocumentTableType);
