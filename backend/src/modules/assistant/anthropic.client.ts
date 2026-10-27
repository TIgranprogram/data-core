import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { API_TIMEOUT_MS, API_URL, API_VERSION } from './assistant.config';
import type { TokenUsage } from './assistant.cost';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export interface ApiMessage { role: 'user' | 'assistant'; content: string | Block[] }
export interface ApiRequest {
  model: string;
  max_tokens: number;
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools: Array<Record<string, unknown>>;
  messages: ApiMessage[];
}
export interface ApiResponse { content: Block[]; stop_reason: string; usage: TokenUsage }

/** Тонкая обёртка над Messages API (без SDK: один запрос). Ключ — только из env, в лог не попадает. */
@Injectable()
export class AnthropicClient {
  private readonly log = new Logger('Assistant');

  configured(): boolean { return !!process.env.ANTHROPIC_API_KEY?.trim(); }

  async create(body: ApiRequest): Promise<ApiResponse> {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException('Помощник не настроен');
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch {
      this.log.warn('Anthropic недоступен (сеть/таймаут)');
      throw new HttpException('Помощник сейчас недоступен. Приложение работает как обычно.', HttpStatus.BAD_GATEWAY);
    }
    if (!res.ok) {
      this.log.warn(`Anthropic ответил ${res.status}`);
      throw new HttpException('Помощник сейчас недоступен. Попробуйте позже.', HttpStatus.BAD_GATEWAY);
    }
    return (await res.json()) as ApiResponse;
  }
}
