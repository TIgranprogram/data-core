import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AnthropicClient, ApiRequest, ApiResponse } from './anthropic.client';
import { AssistantService } from './assistant.service';
import type { AssistantStore, ChatMessage } from './assistant.store';
import { AssistantTools } from './assistant.tools';

const text = (t: string, usage = { input_tokens: 1000, output_tokens: 100 }): ApiResponse => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage });
const toolUse = (id: string, name: string, input = {}): ApiResponse => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 50 } });

function fakeStore(spent = { user: 0, all: 0 }) {
  const saved: ChatMessage[] = [];
  const usage: Array<{ usd: number }> = [];
  const store = {
    history: async () => [] as ChatMessage[],
    spent: async () => spent,
    addUsage: async (_d: string, _u: string, usd: number) => { usage.push({ usd }); },
    saveTurn: async (m: ChatMessage[]) => { saved.push(...m); },
  } as unknown as AssistantStore;
  return { store, saved, usage };
}

function fakeClient(replies: ApiResponse[], configured = true) {
  const calls: ApiRequest[] = [];
  const client = {
    configured: () => configured,
    create: async (b: ApiRequest) => { calls.push(JSON.parse(JSON.stringify(b))); return replies.shift()!; },
  } as unknown as AnthropicClient;
  return { client, calls };
}

const user = { id: 'u1', role: 'manager' };
const tools = (run: AssistantTools['run'] = async () => '{"ok":1}') => ({ definitions: () => [{ name: 'today' }, { name: 'data_gaps' }], run } as unknown as AssistantTools);

describe('AssistantService', () => {
  it('нет ключа — 503 «Помощник не настроен», модель не вызывается', async () => {
    const { client, calls } = fakeClient([], false);
    const s = new AssistantService(client, tools(), fakeStore().store);
    await expect(s.chat(user, { message: 'привет' })).rejects.toThrow(ServiceUnavailableException);
    expect(calls).toHaveLength(0);
  });

  it('цикл: модель → инструмент → ответ; пишет переписку и расход', async () => {
    const { client, calls } = fakeClient([toolUse('t1', 'today'), text('Сегодня 3 дела')]);
    const run = jest.fn(async () => '{"feed":[]}');
    const { store, saved, usage } = fakeStore();
    const r = await new AssistantService(client, tools(run), store).chat(user, { message: 'что сегодня?', context: { section: 'home' } });
    expect(r.reply).toBe('Сегодня 3 дела');
    expect(r.tools).toEqual(['today']);
    expect(run).toHaveBeenCalledWith('today', {}, user);
    expect(calls).toHaveLength(2);
    // результат инструмента ушёл модели вторым шагом; системный промпт и последний инструмент — с кэшем
    expect(JSON.stringify(calls[1].messages)).toContain('tool_result');
    expect(calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((calls[0].tools[1] as { cache_control?: unknown }).cache_control).toEqual({ type: 'ephemeral' });
    expect(calls[0].model).toBe('claude-sonnet-5-5');
    expect(String(calls[0].messages[0].content)).toContain('«Сегодня»');
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    // sonnet: 1500 вход × 3 + 150 выход × 15 за млн
    expect(usage[0].usd).toBeCloseTo((1500 * 3 + 150 * 15) / 1e6, 6);
  });

  it('ошибка инструмента уходит модели как is_error, цикл не падает', async () => {
    const { client, calls } = fakeClient([toolUse('t1', 'today'), text('Не вышло')]);
    const run = async () => { throw new ForbiddenException('Нет доступа'); };
    const r = await new AssistantService(client, tools(run), fakeStore().store).chat(user, { message: 'q' });
    expect(r.reply).toBe('Не вышло');
    expect(JSON.stringify(calls[1].messages)).toContain('"is_error":true');
  });

  it('не больше 6 шагов', async () => {
    const { client, calls } = fakeClient(Array.from({ length: 10 }, (_, i) => toolUse('t' + i, 'today')));
    const r = await new AssistantService(client, tools(), fakeStore().store).chat(user, { message: 'q' });
    expect(calls).toHaveLength(6);
    expect(r.reply).toContain('Не получилось');
  });

  it('лимит исчерпан — 429 до вызова модели', async () => {
    const { client, calls } = fakeClient([text('x')]);
    const s = new AssistantService(client, tools(), fakeStore({ user: 2, all: 2 }).store);
    await expect(s.chat(user, { message: 'q' })).rejects.toThrow(/лимит/i);
    expect(calls).toHaveLength(0);
  });

  it('«Сложно» (opus) — только админ', async () => {
    const { client } = fakeClient([text('ok')]);
    const s = new AssistantService(client, tools(), fakeStore().store);
    await expect(s.chat(user, { message: 'q', model: 'smart' })).rejects.toThrow(ForbiddenException);
    const r = await new AssistantService(fakeClient([text('ok')]).client, tools(), fakeStore().store).chat({ id: 'a', role: 'admin' }, { message: 'q', model: 'smart' });
    expect(r.model).toBe('smart');
  });
});
