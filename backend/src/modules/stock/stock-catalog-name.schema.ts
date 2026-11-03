import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { escapeRe } from '../../common/list-query';

/** Только data-core: постоянный ключ сериализации, не ссылка и не TTL-lock. */
@Schema({ collection: 'stock_catalog_name_reservations', versionKey: false, softDelete: false })
export class StockCatalogName {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, required: true, default: 0 })
  revision!: number;
}
export type StockCatalogNameDocument = HydratedDocument<StockCatalogName>;
export const StockCatalogNameSchema = SchemaFactory.createForClass(StockCatalogName);

/** Simple case-fold для caseless regex: также ſ/s, ς/σ, но не ß/ss, ı/i, ё/е или NFKC. */
export const normalizeCatalogName = (name: string): string => [...name.trim().replace(/\s+/g, ' ')].map((letter) => {
  const re = new RegExp(`^${escapeRe(letter)}$`, 'iu');
  return [letter.toUpperCase().toLowerCase(), letter.toLowerCase(), letter]
    .find((candidate) => [...candidate].length === 1 && re.test(candidate)) ?? letter;
}).join('');
