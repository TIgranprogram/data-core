/** Помощник: модели, цены и лимиты — всё, что меняется без правки логики, в одном месте. */

export type ModelKey = 'fast' | 'normal' | 'smart';

/** «Быстро / Обычно / Сложно». Сложная (opus) — только администратору. */
export const MODELS: Record<ModelKey, { id: string; label: string; adminOnly: boolean }> = {
  fast: { id: 'claude-haiku-5-5', label: 'Быстро', adminOnly: false },
  normal: { id: 'claude-sonnet-5-5', label: 'Обычно', adminOnly: false },
  smart: { id: 'claude-opus-5-5', label: 'Сложно', adminOnly: true },
};
export const DEFAULT_MODEL: ModelKey = 'normal';

/**
 * Цена, $ за миллион токенов. СВЕРИТЬ со страницей цен Anthropic перед запуском (значения — ориентир ТЗ ИИ-1 §7).
 * Кэш: чтение = 0,1 от входа, запись = 1,25 от входа.
 */
export const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 1, out: 5 },
  'claude-sonnet-5-5': { in: 3, out: 15 },
  'claude-opus-5-5': { in: 5, out: 25 },
};
export const CACHE_READ_K = 0.1;
export const CACHE_WRITE_K = 1.25;

/** Лимиты в день (по Москве), $: решение пользователя 2026-10-28 (docs/QUESTIONS.md «ИИ-помощник»). */
export const LIMIT_DAY_ALL_USD = 5;
export const LIMIT_DAY_USER_USD = 2;

/** Переписка хранится 90 дней (TTL-индекс по createdAt). */
export const CHAT_KEEP_DAYS = 90;
/** Шагов цикла «модель → инструмент → модель» не больше. */
export const MAX_STEPS = 6;
export const MAX_TOKENS = 1500;
/** Сколько последних сообщений уходит модели как память разговора. */
export const HISTORY_FOR_MODEL = 10;
export const MESSAGE_MAX = 4000;
/** Ответ инструмента режется до этой длины (символов), чтобы не раздувать вход. */
export const TOOL_RESULT_MAX = 12000;
export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';
export const API_TIMEOUT_MS = 90000;
