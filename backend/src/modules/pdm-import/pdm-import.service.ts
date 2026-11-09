import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { ClientSession, Connection, Model, QueryOptions, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { ProductModuleDocument } from '../../common/catalog/product-module.schema';
import { ProductModule as ProductModuleEntity } from '../../common/catalog/product-module.schema';
import { Product, type ProductDocument } from '../../common/catalog/product.schema';
import { oid } from '../../common/list-query';
import { Material, type MaterialDocument } from '../material/material.schema';
import { PdmFilesService } from '../pdm-files/pdm-files.service';
import type { PdmApplyDto, PdmDecision, PdmFileFormDto, PdmItemDto, PdmTreeDto } from './dto/pdm-tree.dto';
import { PdmImport, type PdmFound, type PdmImportDocument } from './pdm-import.schema';
import { checkLines, checkTree, diffComposite, diffPart, dimensionsOf, linesOf, ownerKindOf, writeOrder, type PlannedLine } from './pdm-plan';
import { buildPlan, exactHit, pdmKey, siteKey, siteOf, type Lookup, type Plan, type PlanRow, type SiteDoc } from './pdm-plan-rows';
import { fastenerPatch, newMaterial, newModule, newProduct, newSortament, parseDecisions, takeFields, updateOf } from './pdm-write';

const STALE = 'Данные на сайте изменились — проверьте ещё раз';
const WITH_DELETED = { includeSoftDeleted: true } as QueryOptions;
const MATERIAL_FIELDS = 'name article sku materialKind isProfile pdmCode pdmAliases pdm dimensions weightKg colors composition assortment standardRef materialGrade typeName updatedAt deletedAt';
const COMPOSITE_FIELDS = 'name article sku composition pdm updatedAt deletedAt';

export interface ApplyResult { importId: string; created: number; linked: number; updated: number; skipped: number; needFiles: string[] }
interface StoredPlan { rows: PlanRow[]; raws: Plan['raws']; blockers: string[]; needFiles: string[] }
/** Итоговое решение по строке плана: что с ней делать при записи. */
interface Fin { row: PlanRow; item: PdmItemDto; id: Types.ObjectId; existing?: SiteDoc; decision?: PdmDecision }

/** Общий вид модели для материалов, модулей и изделий: фильтры и правки здесь собираются вручную. */
type AnyModel = Model<Record<string, unknown>>;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

@Injectable()
export class PdmImportService {
  constructor(
    @InjectModel(PdmImport.name) private readonly imports: Model<PdmImportDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    @InjectModel(ProductModuleEntity.name) private readonly modules: Model<ProductModuleDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly files: PdmFilesService,
  ) {}

  private orgFilter(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? { organizationId: oid(organizationId, 'организации') } : {};
  }

  // ───── предпросмотр ─────

  /** Сравнить дерево PDM с сайтом и сохранить план. Ничего в номенклатуре не меняет. */
  async preview(tree: PdmTreeDto, user: AuthenticatedUser) {
    checkTree(tree); // структурные ошибки (`../`, дубли, цикл) — 400 до обращения к базе
    const look = await this.lookup(tree, user.organizationId);
    const plan = buildPlan(tree, look);
    const needFiles = await this.needFiles(tree, user.organizationId);
    const doc = await this.imports.create({
      treeHash: createHash('sha256').update(JSON.stringify(tree)).digest('hex'), root: tree.root, tree: plain(tree),
      plan: { rows: plan.rows, raws: plan.raws, blockers: plan.blockers, needFiles }, found: plan.found, createdBy: oid(user.id, 'пользователя'),
      ...this.orgFilter(user.organizationId),
    });
    const summary = { create: 0, link: 0, suggest: 0, conflict: 0, same: 0 };
    for (const r of plan.rows) summary[r.action] += 1;
    return { planId: String(doc._id), root: tree.root, summary, items: plan.rows, sortaments: plan.raws, needFiles, blockers: plan.blockers, warnings: tree.warnings ?? [] };
  }

  /** Записи сайта, нужные для плана: по обозначениям (с удалёнными) и кандидаты по ключу для метизов без точного совпадения. */
  private async lookup(tree: PdmTreeDto, organizationId?: string | null): Promise<Lookup> {
    const f = this.orgFilter(organizationId);
    const names = new Set<string>(), by = (kind: string) => tree.items.filter((i) => i.kind === kind).map((i) => i.designation);
    for (const it of tree.items) if (it.kind === 'part' || it.kind === 'fastener' || it.kind === 'purchased') { names.add(it.designation); for (const a of it.kind === 'part' ? [] : it.aliases ?? []) names.add(a); }
    const n = [...names];
    const raw = <T>(p: Promise<unknown>) => p as Promise<T>;
    const [materials, modules, products, profiles] = await Promise.all([
      raw<SiteDoc[]>(n.length ? this.materials.find({ $or: [{ article: { $in: n } }, { pdmCode: { $in: n } }, { pdmAliases: { $in: n } }], ...f }).setOptions(WITH_DELETED).select(MATERIAL_FIELDS).lean().exec() : Promise.resolve([])),
      raw<SiteDoc[]>(this.modules.find({ article: { $in: by('module') }, ...f }).setOptions(WITH_DELETED).select(COMPOSITE_FIELDS).lean().exec()),
      raw<SiteDoc[]>(this.products.find({ sku: { $in: by('product') }, ...f }).setOptions(WITH_DELETED).select(COMPOSITE_FIELDS).lean().exec()),
      raw<SiteDoc[]>(this.materials.find({ isProfile: true, ...f }).setOptions(WITH_DELETED).select(MATERIAL_FIELDS).lean().exec()),
    ]);
    const wanted = new Set(tree.items.filter((i) => (i.kind === 'fastener' || i.kind === 'purchased') && !exactHit(i, materials)).map(pdmKey).filter(Boolean));
    const byKey = new Map<string, SiteDoc[]>();
    if (wanted.size) {
      const cands = (await this.materials.find({ isProfile: { $ne: true }, materialKind: { $ne: 'part' }, ...f }).select(MATERIAL_FIELDS).lean().exec()) as unknown as SiteDoc[];
      for (const c of cands) { const k = siteKey(c); if (wanted.has(k)) byKey.set(k, [...(byKey.get(k) ?? []), c]); }
    }
    return { materials, modules, products, profiles, byKey };
  }

  /** sha256 файлов дерева, которых ещё нет на сервере. */
  private needFiles(tree: PdmTreeDto, organizationId?: string | null): Promise<string[]> {
    return this.files.missingSha(tree.items.flatMap((i) => (i.docs ?? []).map((d) => ({ designation: i.designation, docKind: d.type, sha256: d.sha256 }))), organizationId);
  }

  // ───── загрузка ─────

  /** Записать план одной транзакцией. Повтор того же плана отдаёт прежний итог. */
  async apply(dto: PdmApplyDto, user: AuthenticatedUser): Promise<ApplyResult> {
    const imp = await this.planOf(dto, user.organizationId);
    if (imp.status === 'applied' && imp.result) return imp.result as unknown as ApplyResult;
    const plan = imp.plan as unknown as StoredPlan, tree = imp.tree as unknown as PdmTreeDto;
    if (plan.blockers.length) throw new BadRequestException(`Загрузка невозможна: ${plan.blockers.join('; ')}`);
    const decisions = parseDecisions(dto.decisions);
    const needFiles = await this.needFiles(tree, user.organizationId);
    const session = await this.connection.startSession();
    let result: ApplyResult | undefined;
    try {
      await session.withTransaction(async () => { result = await this.write(imp, plan, tree, decisions, needFiles, user, session); });
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) throw new ConflictException(STALE);
      throw e;
    } finally {
      await session.endSession();
    }
    return result!;
  }

  private async planOf(dto: PdmApplyDto, organizationId?: string | null) {
    const org = this.orgFilter(organizationId);
    let imp: (PdmImport & { _id: Types.ObjectId }) | null;
    if (dto.planId) imp = (await this.imports.findOne({ _id: oid(dto.planId, 'плана'), ...org }).lean().exec()) as typeof imp;
    else if (dto.tree) {
      const treeHash = createHash('sha256').update(JSON.stringify(dto.tree)).digest('hex');
      imp = (await this.imports.findOne({ treeHash, ...org }).sort({ createdAt: -1 }).lean().exec()) as typeof imp;
    } else throw new BadRequestException('Укажите planId — номер плана из предпросмотра');
    if (!imp) throw new NotFoundException('План не найден — сначала выполните предпросмотр');
    return imp;
  }

  /** Тело транзакции. Может выполниться повторно (временный сбой) — всё считается заново. */
  private async write(imp: PdmImport & { _id: Types.ObjectId }, plan: StoredPlan, tree: PdmTreeDto, decisions: Map<string, PdmDecision>, needFiles: string[], user: AuthenticatedUser, session: ClientSession): Promise<ApplyResult> {
    const org = user.organizationId;
    const claim = await this.imports.updateOne({ _id: imp._id, status: 'planned' }, { $set: { appliedBy: oid(user.id, 'пользователя') } }, { session });
    if (!claim.matchedCount) {
      const cur = (await this.imports.findById(imp._id).session(session).lean().exec()) as { status?: string; result?: unknown } | null;
      if (cur?.status === 'applied' && cur.result) return cur.result as ApplyResult;
      throw new ConflictException('Загрузка этого плана уже выполняется');
    }

    // 1. решения по строкам
    const itemOf = new Map(tree.items.map((i) => [i.designation, i]));
    const fins = new Map<string, Fin>();
    for (const row of plan.rows) fins.set(row.designation, this.decide(row, itemOf.get(row.designation)!, decisions.get(row.designation)));
    const rawFin = plan.raws.map((r) => ({ r, id: r.targetId ? new Types.ObjectId(r.targetId) : new Types.ObjectId() }));

    // 2. существующие записи в транзакции + проверка «данные не менялись»
    const docs = await this.loadExisting(fins, rawFin, session);
    this.assertFresh(imp.found, fins, rawFin, docs);

    // 3. составы по плану в памяти (CompositionLineService читает без сессии — здесь не годится)
    const refOf = (d: string) => String(fins.get(d)!.id), rawRefs = new Map(rawFin.map((x) => [x.r.key, String(x.id)]));
    const kindByRef = new Map<string, string>(rawFin.map((x) => [String(x.id), 'raw']));
    for (const f of fins.values()) if (f.item.kind === 'part' || f.item.kind === 'fastener' || f.item.kind === 'purchased') kindByRef.set(String(f.id), f.existing ? (f.existing.isProfile ? 'raw' : f.existing.materialKind ?? 'other') : f.item.kind);
    const lines = new Map<string, PlannedLine[]>();
    for (const f of fins.values()) {
      if (f.item.kind === 'fastener' || f.item.kind === 'purchased') continue;
      const ls = linesOf(tree, f.item, refOf, (k) => rawRefs.get(k)!);
      const bad = checkLines(f.item.kind, f.item.designation, ls, (l) => (l.lineType === 'material' ? kindByRef.get(l.ref) ?? 'other' : l.lineType));
      if (bad) throw new BadRequestException(bad);
      lines.set(f.item.designation, ls);
    }

    // 4. запись: сортаменты → детали → метизы и покупные → модули от листьев → изделие
    const out = { created: 0, linked: 0, updated: 0, skipped: 0 };
    const owners: Record<string, { kind: string; id: Types.ObjectId }> = {};
    const createdMat: Record<string, unknown>[] = [];
    for (const { r, id } of rawFin) {
      if (r.action === 'create') createdMat.push(newSortament(r, id, org));
      else if (r.deleted) await this.materials.updateOne({ _id: id }, { $set: { deletedAt: null } }, { session });
    }
    if (createdMat.length) await this.materials.create(createdMat, { session, ordered: true });

    const order = writeOrder(tree).map((d) => fins.get(d)!);
    const group = (...kinds: string[]) => order.filter((f) => kinds.includes(f.item.kind));
    await this.writeMaterials(group('part'), lines, out, org, session);
    await this.writeFasteners(group('fastener', 'purchased'), out, org, session);
    await this.writeComposite(group('module'), lines, out, org, session, this.modules as unknown as AnyModel, newModule);
    await this.writeComposite(group('product'), lines, out, org, session, this.products as unknown as AnyModel, newProduct);
    for (const f of fins.values()) if (f.item.docs?.length) owners[f.item.designation] = { kind: ownerKindOf(f.item.kind), id: f.id };

    const result: ApplyResult = { importId: String(imp._id), ...out, needFiles };
    await this.imports.updateOne({ _id: imp._id }, { $set: { status: 'applied', decisions: plain(Object.fromEntries(decisions)), result, owners, appliedAt: new Date() } }, { session });
    return result;
  }

  /** Что делать со строкой плана с учётом решения человека. */
  private decide(row: PlanRow, item: PdmItemDto, decision?: PdmDecision): Fin {
    const d = row.designation, chosen = decision?.action === 'link' ? decision.targetId : undefined;
    const base = { row, item, decision };
    if (row.action === 'suggest') {
      if (decision?.action === 'create') return { ...base, id: new Types.ObjectId() };
      if (chosen && row.candidates?.some((c) => c.id === chosen)) return { ...base, id: new Types.ObjectId(chosen), row: { ...row, targetId: chosen } };
      throw new BadRequestException(`Для «${d}» найдено несколько похожих записей — выберите одну или создайте новую`);
    }
    if (row.action === 'create') {
      if (chosen) return { ...base, id: new Types.ObjectId(chosen), row: { ...row, targetId: chosen } };
      return { ...base, id: new Types.ObjectId() };
    }
    if (decision?.action === 'create') throw new BadRequestException(`«${d}» уже есть на сайте — создать вторую запись нельзя`);
    if (chosen && chosen !== row.targetId) throw new BadRequestException(`«${d}» уже связана с записью сайта — другую выбрать нельзя`);
    return { ...base, id: new Types.ObjectId(row.targetId) };
  }

  private async loadExisting(fins: Map<string, Fin>, rawFin: Array<{ r: Plan['raws'][number]; id: Types.ObjectId }>, session: ClientSession): Promise<Map<string, SiteDoc>> {
    const ids = { materials: [] as Types.ObjectId[], modules: [] as Types.ObjectId[], products: [] as Types.ObjectId[] };
    for (const f of fins.values()) if (f.row.targetId) ids[f.item.kind === 'module' ? 'modules' : f.item.kind === 'product' ? 'products' : 'materials'].push(f.id);
    for (const x of rawFin) if (x.r.targetId) ids.materials.push(x.id);
    const load = async (m: AnyModel, list: Types.ObjectId[], select: string) => (list.length ? ((await m.find({ _id: { $in: list } }).setOptions(WITH_DELETED).select(select).session(session).lean().exec()) as unknown as SiteDoc[]) : []);
    const all = [...(await load(this.materials as unknown as AnyModel, ids.materials, MATERIAL_FIELDS)), ...(await load(this.modules as unknown as AnyModel, ids.modules, COMPOSITE_FIELDS)), ...(await load(this.products as unknown as AnyModel, ids.products, COMPOSITE_FIELDS))];
    const byId = new Map(all.map((d) => [String(d._id), d]));
    for (const f of fins.values()) {
      if (!f.row.targetId) continue;
      f.existing = byId.get(String(f.id));
      if (!f.existing) throw new ConflictException(STALE);
      const k = f.item.kind, m = f.existing;
      if ((k === 'part' && m.materialKind !== 'part') || ((k === 'fastener' || k === 'purchased') && (m.isProfile || m.materialKind === 'part'))) throw new BadRequestException(`Запись для «${f.item.designation}» не подходит по виду (${k === 'part' ? 'нужна деталь' : 'нужен метиз или покупное'})`);
    }
    return byId;
  }

  /** 409, если найденные при предпросмотре записи (которые мы используем) изменились. */
  private assertFresh(found: PdmFound[], fins: Map<string, Fin>, rawFin: Array<{ r: Plan['raws'][number]; id: Types.ObjectId }>, docs: Map<string, SiteDoc>): void {
    const used = new Set<string>([...[...fins.values()].filter((f) => f.row.targetId).map((f) => String(f.id)), ...rawFin.filter((x) => x.r.targetId).map((x) => String(x.id))]);
    const ms = (v?: Date | null) => (v ? +new Date(v) : 0);
    for (const f of found) {
      const id = String(f.id);
      if (used.has(id) && ms(docs.get(id)?.updatedAt) !== ms(f.updatedAt)) throw new ConflictException(STALE);
    }
  }

  private async writeMaterials(list: Fin[], lines: Map<string, PlannedLine[]>, out: { created: number; linked: number; updated: number; skipped: number }, org: string | null | undefined, session: ClientSession): Promise<void> {
    const fresh: Record<string, unknown>[] = [];
    for (const f of list) {
      const ls = lines.get(f.item.designation) ?? [];
      if (!f.existing) { fresh.push(newMaterial(f.item, f.id, ls, org)); out.created += 1; continue; }
      out.linked += 1;
      const diff = diffPart(siteOf(f.existing), { dimensions: dimensionsOf(f.item.size), weightKg: f.item.massKg ?? 0, colors: f.item.ral ?? [], lines: ls });
      const set = updateOf({ item: f.item, existing: f.existing, take: takeFields(diff.fill, diff.conflicts, f.decision), lines: ls, renameToPdm: f.decision?.fields?.article === 'pdm' });
      if (!set) { out.skipped += 1; continue; }
      await this.materials.updateOne({ _id: f.id }, { $set: set }, { session });
      out.updated += 1;
    }
    if (fresh.length) await this.materials.create(fresh, { session, ordered: true });
  }

  /** Метизы и покупные: у существующих только pdmCode и другие написания; article не трогаем. Несколько позиций на одну запись складываем. */
  private async writeFasteners(list: Fin[], out: { created: number; linked: number; updated: number; skipped: number }, org: string | null | undefined, session: ClientSession): Promise<void> {
    const fresh: Record<string, unknown>[] = [], patches = new Map<string, { set: Record<string, unknown>; add: Set<string> }>(), seen = new Set<string>();
    for (const f of list) {
      if (!f.existing) { fresh.push(newMaterial(f.item, f.id, [], org)); out.created += 1; continue; }
      const key = String(f.id), sameTarget = seen.has(key);
      seen.add(key);
      if (!sameTarget) out.linked += 1;
      const cur = patches.get(key), view = cur ? { ...f.existing, ...cur.set, pdmAliases: [...(f.existing.pdmAliases ?? []), ...cur.add] } : f.existing;
      const p = fastenerPatch(view as SiteDoc, f.item);
      if (!p) { if (!sameTarget) out.skipped += 1; continue; }
      const acc = cur ?? { set: {}, add: new Set<string>() };
      Object.assign(acc.set, p.set);
      p.add.forEach((a) => acc.add.add(a));
      patches.set(key, acc);
      if (!sameTarget) out.updated += 1;
    }
    for (const [id, p] of patches) await this.materials.updateOne({ _id: new Types.ObjectId(id) }, { ...(Object.keys(p.set).length ? { $set: p.set } : {}), ...(p.add.size ? { $addToSet: { pdmAliases: { $each: [...p.add] } } } : {}) }, { session });
    if (fresh.length) await this.materials.create(fresh, { session, ordered: true });
  }

  private async writeComposite(list: Fin[], lines: Map<string, PlannedLine[]>, out: { created: number; linked: number; updated: number; skipped: number }, org: string | null | undefined, session: ClientSession, model: AnyModel, make: typeof newModule): Promise<void> {
    const fresh: Record<string, unknown>[] = [];
    for (const f of list) {
      const ls = lines.get(f.item.designation) ?? [];
      if (!f.existing) { fresh.push(make(f.item, f.id, ls, org)); out.created += 1; continue; }
      out.linked += 1;
      const diff = diffComposite(f.existing.composition, ls);
      const set = updateOf({ item: f.item, existing: f.existing, take: takeFields(diff.fill, diff.conflicts, f.decision), lines: ls, renameToPdm: f.decision?.fields?.[f.item.kind === 'product' ? 'sku' : 'article'] === 'pdm' });
      if (!set) { out.skipped += 1; continue; }
      await model.updateOne({ _id: f.id }, { $set: set }, { session });
      out.updated += 1;
    }
    // модули пишем в порядке «листья первыми» (list уже в нём); одной пачкой — порядок вставки сохраняется
    if (fresh.length) await model.create(fresh, { session, ordered: true });
  }

  // ───── файлы ─────

  /** Принять файл дерева: владелец — запись, созданная/найденная этой загрузкой. Файла нет в дереве — 400. */
  async saveFile(form: PdmFileFormDto, buf: Buffer, user: AuthenticatedUser) {
    const imp = (await this.imports.findOne({ _id: oid(form.importId, 'загрузки'), ...this.orgFilter(user.organizationId) }).lean().exec()) as (PdmImport & { _id: Types.ObjectId }) | null;
    if (!imp) throw new NotFoundException('Загрузка не найдена');
    if (imp.status !== 'applied') throw new ConflictException('Сначала примените загрузку, потом отправляйте файлы');
    const item = (imp.tree as unknown as PdmTreeDto).items.find((i) => i.designation === form.designation);
    const doc = item?.docs?.find((d) => d.type === form.type && d.sha256.toLowerCase() === form.sha256.toLowerCase() && d.version === form.version);
    const owner = imp.owners?.[form.designation];
    if (!item || !doc || !owner) throw new BadRequestException('Такого файла нет в загруженном дереве');
    if (doc.name !== form.name) throw new BadRequestException('Имя файла не совпадает с деревом');
    return this.files.save({ ownerKind: owner.kind, ownerId: String(owner.id), designation: form.designation, docKind: form.type, name: doc.name, pdmVersion: doc.version, pdmFileId: form.pdmFileId ?? doc.pdmFileId, pdmState: form.state ?? doc.state, modified: form.modified ?? doc.modified, sha256: form.sha256 }, buf, user.organizationId);
  }
}
