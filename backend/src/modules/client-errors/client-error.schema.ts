import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ClientErrorDocument = HydratedDocument<ClientError>;

export const CLIENT_ERROR_KINDS = ['action', 'background', 'unhandled', 'slow'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** Срок хранения записи (TTL по createdAt). */
export const CLIENT_ERROR_TTL_DAYS = 30;

/**
 * ОШ2.1 — ошибка, пойманная в приложении (`pwa/core/errors.js`).
 * Коллекция только data-core; данных форм нет — только что, где и что делал человек.
 * Журнал, не сущность: без мягкого удаления, записи уходят сами через 30 дней.
 */
@Schema({ collection: 'clienterrors', timestamps: { createdAt: true, updatedAt: false }, softDelete: false })
export class ClientError {
  /** Ключ группировки: хэш name + message (без чисел/id) + section + url. */
  @Prop({ required: true })
  sig!: string;

  @Prop({ required: true })
  message!: string;

  @Prop()
  name?: string;

  @Prop()
  stack?: string;

  /** Раздел приложения (`#раздел`). */
  @Prop()
  section?: string;

  /** Что делал человек: «Сохранить паспорт», «загрузка списка». */
  @Prop()
  action?: string;

  @Prop({ required: true, enum: CLIENT_ERROR_KINDS })
  kind!: ClientErrorKind;

  /** HTTP-код, если упал запрос. */
  @Prop()
  status?: number;

  /** Путь API без query. */
  @Prop()
  url?: string;

  /** Версия приложения. */
  @Prop()
  version?: string;

  @Prop()
  ua?: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop()
  role?: string;

  createdAt?: Date;
}

export const ClientErrorSchema = SchemaFactory.createForClass(ClientError);
ClientErrorSchema.index({ createdAt: 1 }, { expireAfterSeconds: CLIENT_ERROR_TTL_DAYS * 24 * 3600 });
ClientErrorSchema.index({ sig: 1, createdAt: -1 });
