import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { PdmTreeDto } from './dto/pdm-tree.dto';
import { PdmImportService } from './pdm-import.service';
import { buildPlan, type SiteDoc } from './pdm-plan-rows';
import { miniTree } from './pdm-tree.testkit';

const user = { id: new Types.ObjectId().toHexString(), username: 'admin', role: 'admin' } as AuthenticatedUser;
const tree = (): PdmTreeDto => JSON.parse(JSON.stringify(miniTree()));
/** Цепочка запросов mongoose: любые select/session/setOptions/lean возвращают её же, exec отдаёт значение. */
const q = (value: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'session', 'setOptions', 'sort', 'lean']) c[m] = () => c; c.exec = async () => value; return c; };

interface Setup { service: PdmImportService; log: string[]; created: Record<string, Array<Record<string, any>>>; updates: Array<[string, unknown, unknown]>; imports: any; started: () => number }

/** Сервис на заглушках: пишет в журнал порядок записей; `existing` — что «лежит» на сайте. */
function setup(imp: Record<string, unknown>, existing: { materials?: SiteDoc[]; modules?: SiteDoc[]; products?: SiteDoc[] } = {}): Setup {
  const log: string[] = [], created: Setup['created'] = { materials: [], productmodules: [], products: [] }, updates: Setup['updates'] = [];
  const model = (coll: keyof typeof created, rows: SiteDoc[] = []) => ({
    find: () => q(rows),
    create: async (docs: Array<Record<string, any>>) => { log.push(`${coll}:${docs.map((d) => d.article ?? d.sku).join(',')}`); created[coll].push(...docs); return docs; },
    updateOne: async (f: unknown, u: unknown) => { updates.push([coll, f, u]); return { matchedCount: 1 }; },
  });
  const imports = {
    updateOne: jest.fn(async (_f: unknown, u: { $set: Record<string, unknown> }) => { if (u.$set.status) log.push('journal'); return { matchedCount: 1 }; }),
    findOne: () => q(imp), findById: () => q(imp),
  };
  let started = 0;
  const connection = { startSession: async () => { started += 1; return { withTransaction: async (fn: () => Promise<void>) => { await fn(); }, endSession: async () => undefined }; } };
  const files = { missingSha: async () => [] };
  const service = new PdmImportService(imports as never, model('materials', existing.materials) as never, model('productmodules', existing.modules) as never, model('products', existing.products) as never, connection as never, files as never);
  return { service, log, created, updates, imports, started: () => started };
}

/** План и запись об импорте для дерева; `existing` — записи сайта, найденные при «предпросмотре». */
function importOf(t: PdmTreeDto, existing: { materials?: SiteDoc[]; modules?: SiteDoc[]; products?: SiteDoc[] } = {}, extra: Record<string, unknown> = {}) {
  const plan = buildPlan(t, { materials: existing.materials ?? [], modules: existing.modules ?? [], products: existing.products ?? [], profiles: [], byKey: new Map() });
  return { _id: new Types.ObjectId(), status: 'planned', tree: t, plan: { rows: plan.rows, raws: plan.raws, blockers: plan.blockers, needFiles: [] }, found: plan.found, ...extra };
}

describe('PdmImportService.apply', () => {
  it('порядок записи: сортаменты → детали → метизы и покупные → модули → изделие; журнал в конце', async () => {
    const s = setup(importOf(tree()));
    const res = await s.service.apply({ planId: new Types.ObjectId().toHexString() }, user);
    expect(s.log.map((l) => l.split(':')[0])).toEqual(['materials', 'materials', 'materials', 'productmodules', 'products', 'journal']);
    expect(s.log[0]).toMatch(/^materials:Сортамент: Лист.*,Сортамент: Фанера/);
    expect(s.log[1]).toBe('materials:0000.1005.0001,0000.1005.0002,0000.1005.0003,0000.0000.2002');
    expect(s.log[2]).toBe('materials:SHP08.D125,PI.0003');
    expect(res).toMatchObject({ created: 8, linked: 0, updated: 0, skipped: 0 });
  });

  it('новые записи: name = обозначение, needsName, sku материалов нет; метизы — pdmCode и другие написания', async () => {
    const s = setup(importOf(tree()));
    await s.service.apply({ planId: new Types.ObjectId().toHexString() }, user);
    const byArticle = (a: string) => s.created.materials.find((d) => d.article === a)!;
    expect(byArticle('0000.1005.0001')).toMatchObject({ name: '0000.1005.0001', needsName: true, materialKind: 'part', weightKg: 0.27, colors: ['8017'], dimSource: 'dxf', pdm: { version: 3, state: 'Утверждено' } });
    expect(s.created.materials.every((d) => !('sku' in d))).toBe(true);
    expect(byArticle('SHP08.D125')).toMatchObject({ materialKind: 'fastener', pdmCode: 'SHP08.D125', pdmAliases: ['ШП08.D125'], unit: 'шт' });
    expect(s.created.materials.find((d) => d.isProfile)).toMatchObject({ unit: 'м²', materialKind: 'raw', scrapFactor: 1 });
    expect(s.created.products[0]).toMatchObject({ sku: '6104.0000.0000', name: '6104.0000.0000', needsName: true });
  });

  it('расход сырья детали и состав без сырья в изделии', async () => {
    const s = setup(importOf(tree()));
    await s.service.apply({ planId: new Types.ObjectId().toHexString() }, user);
    const part = s.created.materials.find((d) => d.article === '0000.1005.0001')!, sheetId = s.created.materials.find((d) => d.isProfile && d.unit === 'м²' && /Лист/.test(d.name))!._id;
    expect(part.composition).toHaveLength(1);
    expect(part.composition[0]).toMatchObject({ lineType: 'material', quantity: 0.020248, unit: 'м²', overrideDimensions: { length: 253.1, width: 80, height: 4 } });
    expect(String(part.composition[0].refId)).toBe(String(sheetId));
    const product = s.created.products[0];
    expect(product.composition.map((l: any) => l.lineType)).toEqual(['module', 'material', 'material', 'material']);
    expect(product.composition.every((l: any) => String(l.refId) !== String(sheetId))).toBe(true);
    expect(s.created.productmodules[0].composition).toHaveLength(3);
  });

  it('повтор того же плана — прежний итог, вторая транзакция не стартует', async () => {
    const result = { importId: 'x', created: 8, linked: 0, updated: 0, skipped: 0, needFiles: [] };
    const s = setup(importOf(tree(), {}, { status: 'applied', result }));
    expect(await s.service.apply({ planId: new Types.ObjectId().toHexString() }, user)).toEqual(result);
    expect(s.started()).toBe(0);
    expect(s.log).toEqual([]);
  });

  it('409, если найденная запись изменилась после предпросмотра; ничего не записано', async () => {
    const part = { _id: new Types.ObjectId(), article: '0000.1005.0001', materialKind: 'part', updatedAt: new Date('2026-11-01') } as SiteDoc;
    const imp = importOf(tree(), { materials: [part] });
    const s = setup(imp, { materials: [{ ...part, updatedAt: new Date('2026-11-05') }] });
    await expect(s.service.apply({ planId: String(imp._id) }, user)).rejects.toThrow(ConflictException);
    await expect(s.service.apply({ planId: String(imp._id) }, user)).rejects.toThrow('Данные на сайте изменились — проверьте ещё раз');
    expect(s.log).toEqual([]);
  });

  it('удалённая деталь восстанавливается и обновляется; остальное создаётся', async () => {
    const part = { _id: new Types.ObjectId(), article: '0000.1005.0001', materialKind: 'part', updatedAt: new Date('2026-11-01'), deletedAt: new Date('2026-10-01') } as SiteDoc;
    const s = setup(importOf(tree(), { materials: [part] }), { materials: [part] });
    const res = await s.service.apply({ planId: new Types.ObjectId().toHexString() }, user);
    const upd = s.updates.find(([, f]) => String((f as { _id: unknown })._id) === String(part._id))!;
    expect((upd[2] as { $set: Record<string, unknown> }).$set).toMatchObject({ deletedAt: null, dimSource: 'dxf', weightKg: 0.27 });
    expect(res).toMatchObject({ created: 7, linked: 1, updated: 1 });
  });

  it('расхождение без решения оставляет данные сайта, «update-all» берёт PDM', async () => {
    const part = { _id: new Types.ObjectId(), article: '0000.0000.2002', materialKind: 'part', weightKg: 9, pdm: { version: 1, state: 'Утверждено' }, updatedAt: new Date('2026-11-01') } as SiteDoc;
    const imp = importOf(tree(), { materials: [part] });
    const keep = setup(imp, { materials: [part] });
    await keep.service.apply({ planId: String(imp._id) }, user);
    expect(keep.updates.map(([, , u]) => (u as { $set: Record<string, unknown> }).$set.weightKg)).not.toContain(3.5);
    const all = setup(imp, { materials: [part] });
    await all.service.apply({ planId: String(imp._id), decisions: { '0000.0000.2002': { action: 'update-all' } } }, user);
    expect(all.updates.some(([, , u]) => (u as { $set: Record<string, unknown> }).$set.weightKg === 3.5)).toBe(true);
    const fields = setup(imp, { materials: [part] });
    await fields.service.apply({ planId: String(imp._id), decisions: { '0000.0000.2002': { action: 'link', fields: { weightKg: 'pdm' } } } }, user);
    expect(fields.updates.some(([, , u]) => (u as { $set: Record<string, unknown> }).$set.weightKg === 3.5)).toBe(true);
  });

  it('метиз на сайте: добавляются только pdmCode и написания, article не трогаем', async () => {
    const fastener = { _id: new Types.ObjectId(), article: 'ШАЙБА-8', materialKind: 'fastener', updatedAt: new Date('2026-11-01') } as SiteDoc;
    const t = tree();
    const imp = importOf(t, { materials: [{ ...fastener, pdmAliases: ['SHP08.D125'] }] });
    const s = setup(imp, { materials: [{ ...fastener, pdmAliases: ['SHP08.D125'] }] });
    await s.service.apply({ planId: String(imp._id) }, user);
    const u = s.updates.find(([, f]) => String((f as { _id: unknown })._id) === String(fastener._id))![2] as { $set?: Record<string, unknown>; $addToSet?: { pdmAliases: { $each: string[] } } };
    expect(u.$set).toEqual({ pdmCode: 'SHP08.D125' });
    expect(u.$addToSet?.pdmAliases.$each).toEqual(['ШП08.D125']);
    expect(JSON.stringify(u)).not.toContain('article');
  });

  it('метиз на сайте — «сырьё»: в изделие его положить нельзя', async () => {
    const raw = { _id: new Types.ObjectId(), article: 'SHP08.D125', materialKind: 'raw', updatedAt: new Date('2026-11-01') } as SiteDoc;
    const imp = importOf(tree(), { materials: [raw] });
    const s = setup(imp, { materials: [raw] });
    await expect(s.service.apply({ planId: String(imp._id) }, user)).rejects.toThrow(/нельзя добавить сырьё/);
    expect(s.log).toEqual([]);
  });

  it('похожие записи без решения — 400; с выбором — связь с выбранной', async () => {
    const t = tree(), a = { _id: new Types.ObjectId(), article: 'ШП-1', updatedAt: new Date('2026-11-01') } as SiteDoc, b = { ...a, _id: new Types.ObjectId(), article: 'ШП-2' } as SiteDoc;
    const base = importOf(t);
    const row = base.plan.rows.find((r) => r.designation === 'SHP08.D125')!;
    Object.assign(row, { action: 'suggest', by: 'matchKey', candidates: [a, b].map((d) => ({ id: String(d._id), article: d.article!, name: '' })) });
    const imp = { ...base, found: [{ coll: 'materials', id: a._id, updatedAt: a.updatedAt }, { coll: 'materials', id: b._id, updatedAt: b.updatedAt }] };
    await expect(setup(imp, { materials: [a, b] }).service.apply({ planId: String(imp._id) }, user)).rejects.toThrow(BadRequestException);
    const ok = setup(imp, { materials: [a, b] });
    await ok.service.apply({ planId: String(imp._id), decisions: { 'SHP08.D125': { action: 'link', targetId: String(b._id) } } }, user);
    expect(ok.updates.some(([, f]) => String((f as { _id: unknown })._id) === String(b._id))).toBe(true);
    expect(ok.created.materials.some((d) => d.article === 'SHP08.D125')).toBe(false);
  });

  it('загрузка с блокировками не выполняется', async () => {
    const t = tree(); t.bom.push({ parent: '0000.1005.0001', child: 'PI.0003', qty: 1 });
    const s = setup(importOf(t));
    await expect(s.service.apply({ planId: new Types.ObjectId().toHexString() }, user)).rejects.toThrow(/Загрузка невозможна/);
    expect(s.started()).toBe(0);
  });

  it('план не найден — 404 с подсказкой', async () => {
    const s = setup(null as never);
    await expect(s.service.apply({ planId: new Types.ObjectId().toHexString() }, user)).rejects.toThrow('сначала выполните предпросмотр');
    await expect(s.service.apply({}, user)).rejects.toThrow(BadRequestException);
  });
});
