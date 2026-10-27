import { HttpException } from '@nestjs/common';
import { assertWithinLimit, calcUsd } from './assistant.cost';

describe('assistant.cost', () => {
  it('считает $ по токенам с учётом кэша', () => {
    // sonnet: вход 3, выход 15 за млн; кэш-чтение 0,1; кэш-запись 1,25
    const usd = calcUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 });
    expect(usd).toBeCloseTo(3 + 1.5 + 0.3 + 3.75, 6);
  });

  it('неизвестная модель — по цене самой дорогой', () => {
    expect(calcUsd('x', { output_tokens: 1_000_000 })).toBe(25);
  });

  it('лимит человека и общий — 429 по-русски', () => {
    expect(() => assertWithinLimit({ user: 1.99, all: 4.99 })).not.toThrow();
    try { assertWithinLimit({ user: 2, all: 2 }); fail('ждали 429'); } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).message).toContain('Ваш лимит');
    }
    expect(() => assertWithinLimit({ user: 0.1, all: 5 })).toThrow(/Общий лимит/);
  });
});
