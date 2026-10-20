import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
}

export const PersonSchema = SchemaFactory.createForClass(Person);
PersonSchema.index({ lastName: 1, firstName: 1, patronymic: 1 });
/** TZ-PARTY-305: дубли телефона запрещены (sparse — null/undefined пропускаются). */
PersonSchema.index({ phone: 1 }, { unique: true, sparse: true });
