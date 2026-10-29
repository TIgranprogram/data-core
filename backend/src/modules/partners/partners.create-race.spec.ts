import { PartnersService } from './partners.service';

/** Дубль «Арабелла» (2026-10-29): двойное нажатие «Создать» — два запроса сразу; создаться должна одна запись, второй — 409. */
describe('PartnersService.create — двойное нажатие', () => {
  it('два одновременных запроса с одним названием → одна запись', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const coll = {
      findOne: async (f: { name: RegExp }) => { await new Promise((r) => setTimeout(r, 5)); return rows.find((x) => f.name.test(String(x.name))) ?? null; },
      insertOne: async (d: Record<string, unknown>) => { rows.push(d); return { insertedId: 'o' + rows.length }; },
    };
    const svc = new PartnersService({ db: { collection: () => coll } } as never);
    jest.spyOn(svc as never, 'cleanRequisites' as never).mockImplementation((async () => ({})) as never);
    jest.spyOn(svc, 'get').mockImplementation((async (id: string) => ({ id })) as never);
    const r = await Promise.allSettled([svc.create({ kind: 'supplier', name: 'Арабелла' } as never), svc.create({ kind: 'supplier', name: ' арабелла ' } as never)]);
    expect(rows).toHaveLength(1);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});
