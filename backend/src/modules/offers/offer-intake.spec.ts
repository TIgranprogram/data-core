import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { OfferIntakeService } from './offer-intake.service';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Витрина-заглушка: находит изделия по точному запросу и запоминает, что спрашивали. */
function fakeShowcase(found: Record<string, Doc[]>) {
  const asked: string[] = [];
  const list = async (q: Doc) => {
    asked.push(String(q.search));
    const items = (found[String(q.search)] ?? []).slice(0, Number(q.limit));
    return { items, total: items.length, page: 1, limit: q.limit };
  };
  return { asked, svc: { list } };
}
function ai(reply: Doc | (() => never)) {
  const calls: Doc[] = [];
  const parse = async (p: Doc) => { calls.push(p); return typeof reply === 'function' ? reply() : reply; };
  return { calls, client: { messages: { parse } } };
}
const ok = (lines: Doc[]) => ({ stop_reason: 'end_turn', parsed_output: { lines }, usage: { input_tokens: 10, output_tokens: 5 } });
function make(reply: Doc | (() => never), found: Record<string, Doc[]> = {}) {
  const s = fakeShowcase(found);
  const a = ai(reply);
  return { svc: new OfferIntakeService(s.svc as never, a.client as never), asked: s.asked, calls: a.calls };
}

describe('КП: разбор заявки ИИ (К7)', () => {
  it('строки заявки → варианты каталога: запросы по порядку, первый с находками выигрывает', async () => {
    const t = make(ok([{ name: 'Тренажёр жим от груди', quantity: 2, unit: 'шт', queries: ['СТ-101', 'жим груди'] }]),
      { 'жим груди': [{ id: 'p1', name: 'Жим от груди' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] });
    const r = await t.svc.parse('Нужно 2 тренажёра жим от груди');
    expect(t.asked).toEqual(['СТ-101', 'жим груди']);
    expect(r).toMatchObject({ total: 1, found: 1 });
    expect(r.items[0]).toMatchObject({ asked: 'Тренажёр жим от груди', quantity: 2, unit: 'шт' });
    expect(r.items[0].variants).toHaveLength(3);
  });

  it('ничего не нашлось — строка остаётся с пустыми вариантами; последним пробуется название заказчика', async () => {
    const t = make(ok([{ name: 'Горка', quantity: 0, unit: '', queries: ['горка'] }, { name: '  ', quantity: 1, unit: 'шт', queries: [] }]));
    const r = await t.svc.parse('Горка');
    expect(t.asked).toEqual(['горка', 'Горка']);
    expect(r).toMatchObject({ total: 1, found: 0 });
    expect(r.items[0]).toMatchObject({ quantity: 1, unit: 'шт', variants: [] });
  });

  it('в ИИ уходит только текст заявки; модель и вывод по схеме заданы', async () => {
    const t = make(ok([]));
    await t.svc.parse('  Лавочка 3 шт  ');
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].messages).toEqual([{ role: 'user', content: 'Лавочка 3 шт' }]);
    expect(t.calls[0].model).toBe('claude-opus-5-5');
    expect(t.calls[0].output_config.format).toBeDefined();
  });

  it('пустой и слишком длинный текст — 400 без обращения к ИИ', async () => {
    const t = make(ok([]));
    await expect(t.svc.parse(' ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.parse('а'.repeat(20001))).rejects.toThrow(/разбейте/);
    expect(t.calls).toHaveLength(0);
  });

  it('отказ ИИ и обрыв по длине — понятная ошибка, не пустой успех', async () => {
    await expect(make({ stop_reason: 'refusal', parsed_output: null, usage: {} }).svc.parse('текст заявки')).rejects.toThrow(/отказался/);
    await expect(make({ stop_reason: 'max_tokens', parsed_output: null, usage: {} }).svc.parse('текст заявки')).rejects.toThrow(/разбейте/);
  });

  it('сбой связи с ИИ → 503 с подсказкой, что делать', async () => {
    const t = make(() => { throw new Anthropic.APIConnectionError({ message: 'нет сети' }); });
    await expect(t.svc.parse('текст заявки')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('без ключа ИИ выключен: enabled() = false, разбор — 503', async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const svc = new OfferIntakeService(fakeShowcase({}).svc as never);
      expect(svc.enabled()).toBe(false);
      await expect(svc.parse('текст заявки')).rejects.toThrow(/не подключён/);
    } finally {
      if (old !== undefined) process.env.ANTHROPIC_API_KEY = old;
    }
  });
});
