import { BadRequestException } from '@nestjs/common';
import { AssistantTools, compact } from './assistant.tools';

function make(over: Record<string, unknown> = {}) {
  const deps = {
    today: { get: jest.fn() },
    partners: { list: jest.fn() },
    stock: { lookup: jest.fn() },
    supply: { list: jest.fn(async () => ({ items: [{ num: 1, title: 'Лист', priceHint: 500, statusLabel: 'Оплачено' }], total: 1, counts: { all: 1 } })) },
    orders: { list: jest.fn(), get: jest.fn() },
    finance: { summary: jest.fn(async () => ({ months: [{ income: 100 }] })), forecast: jest.fn() },
    audit: { report: jest.fn() },
    ...over,
  };
  const t = new AssistantTools(deps.today as never, deps.partners as never, deps.stock as never, deps.supply as never, deps.orders as never, deps.finance as never, deps.audit as never);
  return { t, deps };
}

describe('AssistantTools: деньги и права', () => {
  it('без права на деньги финансовый инструмент не показывается и не выполняется', async () => {
    const { t, deps } = make();
    const names = t.definitions({ id: 'u', role: 'manager' }).map((d) => d.name);
    expect(names).not.toContain('finance_summary');
    await expect(t.run('finance_summary', {}, { id: 'u', role: 'manager' })).rejects.toThrow(BadRequestException);
    expect(deps.finance.summary).not.toHaveBeenCalled();
  });

  it('директор видит финансовый инструмент', async () => {
    const { t } = make();
    expect(t.definitions({ id: 'd', role: 'director' }).map((d) => d.name)).toContain('finance_summary');
    expect(await t.run('finance_summary', {}, { id: 'd', role: 'director' })).toContain('"income":100');
  });

  it('суммы из других инструментов вырезаются у менеджера, у директора остаются', async () => {
    const { t } = make();
    const m = await t.run('list_supply_requests', {}, { id: 'u', role: 'manager' });
    expect(m).not.toContain('priceHint');
    expect(m).toContain('Лист');
    expect(await t.run('list_supply_requests', {}, { id: 'd', role: 'director' })).toContain('priceHint');
  });

  it('фильтр «оплачено» без права на деньги не применяется', async () => {
    const { t, deps } = make();
    await t.run('list_supply_requests', { status: 'paid' }, { id: 'u', role: 'manager' });
    expect((deps.supply.list.mock.calls as unknown as Array<[{ status?: string }]>)[0][0].status).toBeUndefined();
  });

  it('compact убирает фото и служебные поля, режет списки', () => {
    const r = compact({ _id: 'a', id: 'a', photos: [1], name: 'x', rows: Array.from({ length: 50 }, (_, i) => i) }) as { rows: number[] };
    expect(r).toEqual({ id: 'a', name: 'x', rows: expect.any(Array) });
    expect(r.rows).toHaveLength(30);
  });
});
