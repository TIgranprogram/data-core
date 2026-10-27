import { HttpException, HttpStatus } from '@nestjs/common';
import { CACHE_READ_K, CACHE_WRITE_K, LIMIT_DAY_ALL_USD, LIMIT_DAY_USER_USD, PRICES } from './assistant.config';

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Стоимость одного ответа модели, $ (6 знаков). Неизвестная модель — цена самой дорогой. */
export function calcUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? { in: 4, out: 20 };
  const usd = ((u.input_tokens ?? 0) * p.in + (u.cache_read_input_tokens ?? 0) * p.in * CACHE_READ_K
    + (u.cache_creation_input_tokens ?? 0) * p.in * CACHE_WRITE_K + (u.output_tokens ?? 0) * p.out) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/** Бросает 429, если исчерпан дневной лимит человека или всех. */
export function assertWithinLimit(spent: { user: number; all: number }): void {
  if (spent.user >= LIMIT_DAY_USER_USD) throw new HttpException('Ваш лимит помощника на сегодня исчерпан. Завтра он обновится.', HttpStatus.TOO_MANY_REQUESTS);
  if (spent.all >= LIMIT_DAY_ALL_USD) throw new HttpException('Общий лимит помощника на сегодня исчерпан. Завтра он обновится.', HttpStatus.TOO_MANY_REQUESTS);
}

export const sumUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
  output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
});
