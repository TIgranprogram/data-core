import { Types } from 'mongoose';
import { CODE_RE, makeCode, qrUrl } from './qr-code';
import { pagesFor, renderQrSheet } from './qr-pdf';
import { QrService } from './qr.service';

/** Модель в памяти: findOne по паре или коду, create с уникальностью. */
function fakeCodes(opts: { raceOnce?: boolean } = {}) {
  const rows: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let race = !!opts.raceOnce;
  const q = (v: unknown) => ({ lean: () => ({ exec: async () => v }) });
  return {
    rows,
    findOne: (f: Record<string, any>) => q(rows.find((r) => (f.code ? r.code === f.code : r.entityType === f.entityType && String(r.entityId) === String(f.entityId))) ?? null), // eslint-disable-line @typescript-eslint/no-explicit-any
    create: async (d: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (race) { race = false; rows.push({ ...d, code: 'S-RACERACE' }); throw Object.assign(new Error('dup'), { code: 11000 }); }
      if (rows.some((r) => r.code === d.code || (r.entityType === d.entityType && String(r.entityId) === String(d.entityId)))) throw Object.assign(new Error('dup'), { code: 11000 });
      rows.push(d); return d;
    },
  };
}
const model = (rows: Record<string, any>[]) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  find: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => rows }) }) }),
});

describe('QR: код', () => {
  it('формат', () => {
    for (let i = 0; i < 100; i++) expect(makeCode('P')).toMatch(CODE_RE);
    expect('S-0OIL1111').not.toMatch(CODE_RE);
  });
  it('адрес', () => expect(qrUrl('S-7K3QX9TD', 'https://x.ru/db/')).toBe('https://x.ru/db/q/S-7K3QX9TD'));
});

describe('QrService', () => {
  const mk = (codes: ReturnType<typeof fakeCodes>, mats: any[] = [], prods: any[] = []) => // eslint-disable-line @typescript-eslint/no-explicit-any
    new QrService(codes as never, model(mats) as never, model(prods) as never);

  it('ensureCode идемпотентен', async () => {
    const codes = fakeCodes(); const s = mk(codes); const id = new Types.ObjectId();
    const a = await s.ensureCode('S', id); const b = await s.ensureCode('S', String(id));
    expect(a).toBe(b); expect(codes.rows).toHaveLength(1);
  });

  it('гонка 11000: возвращает код победителя', async () => {
    const codes = fakeCodes({ raceOnce: true }); const s = mk(codes); const id = new Types.ObjectId();
    codes.rows.length = 0;
    // победитель появляется с тем же entityId
    const orig = codes.create; codes.create = async (d) => { try { return await orig(d); } catch (e) { codes.rows[0].entityType = d.entityType; codes.rows[0].entityId = d.entityId; throw e; } };
    expect(await s.ensureCode('P', id)).toBe('S-RACERACE');
  });

  it('GET удалённой позиции — deleted:true; неверный код — 400', async () => {
    const id = new Types.ObjectId();
    const codes = fakeCodes(); codes.rows.push({ code: 'S-7K3QX9TD', entityType: 'S', entityId: id });
    const s = mk(codes, [{ _id: id, name: 'Труба', article: 'T1', deletedAt: new Date() }]);
    expect(await s.resolve('S-7K3QX9TD')).toMatchObject({ entityType: 'S', name: 'Труба', article: 'T1', deleted: true });
    await expect(s.resolve('bad')).rejects.toThrow();
  });

  it('print: 36 позиций = 2 листа, skip сдвигает', async () => {
    const mats = Array.from({ length: 36 }, (_, i) => ({ _id: new Types.ObjectId(), name: `Позиция ${i}`, article: `A${i}` }));
    const s = mk(fakeCodes(), mats);
    const pdf = await s.print(mats.map((m) => ({ type: 'S' as const, id: String(m._id) })));
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(2);
    expect(pagesFor(35)).toBe(1); expect(pagesFor(35, 1)).toBe(2); expect(pagesFor(36)).toBe(2);
    const sk = await renderQrSheet([{ code: 'S-7K3QX9TD', name: 'x', article: null }], 34);
    expect((sk.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(1);
    const sk2 = await renderQrSheet([{ code: 'S-7K3QX9TD', name: 'x', article: null }, { code: 'S-7K3QX9TE', name: 'y', article: null }], 34);
    expect((sk2.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(2);
  });
});
