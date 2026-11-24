import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import { legalHash } from '../../common/legal/legal-utils';
import { storedModuleMaterialLines, storedProductModuleLines } from '../../common/catalog/composition-line.service';
import { oid } from '../../common/list-query';
import { claimWritableOrders, withOrderWrite } from '../../common/order-archive/write';
import { saveReleasedProductComposition } from '../product/product-writes';

import type { CounterService } from '../counter/counter.service';
import type { WorkStep } from '../../common/work-step';
import type { WorkTaskDocument } from './work-task.schema';
import { positionAt } from './work-flow';

type Ready = { lineId: string; stamp: string };
type CatalogLine = { _id?: Types.ObjectId; lineType: string; refId: Types.ObjectId; quantity?: number; sortOrder?: number; unit?: string; overrideDimensions?: unknown };
type ModuleRoute = { workTypeId: Types.ObjectId; sortOrder?: number; estimatedHours?: number };
const same = (a: unknown, b: unknown) => String(a) === String(b);
export const moduleWorkKey = (incomeId: unknown, lineId: unknown) => String(incomeId) + ':' + String(lineId);

/** Передача конкретного вхождения модуля, с сохранением каталожного источника в задании. */
export class ModuleWorkRelease {
  constructor(
    private readonly connection: Connection,
    private readonly tasks: Model<WorkTaskDocument>,
    private readonly counters: CounterService,
  ) {}

  private get db() { return this.connection.db!; }

  private async context(designId: string, session?: ClientSession) {
    const design = await this.db.collection('designtasks').findOne({ _id: oid(designId, 'задачи проектирования'), deletedAt: null }, { session });
    if (!design) throw new NotFoundException('Задача проектирования не найдена');
    const line = design.incomeId
      ? await this.db.collection('incomes').findOne({ _id: design.incomeId, deletedAt: null, cancelledAt: null }, { session })
      : null;
    const productId = line ? line.productId : design.productId;
    const product = productId
      ? await this.db.collection('products').findOne({ _id: productId, deletedAt: null }, { session, projection: { name: 1, composition: 1, productModuleIds: 1, organizationId: 1 } })
      : null;
    const comp = ((product?.composition ?? []) as CatalogLine[]).filter((row) => row.lineType === 'module' && row._id);
    return { design, line, product, comp };
  }

  private async moduleRoutes(lines: CatalogLine[], session?: ClientSession) {
    const modules = await this.db.collection('productmodules').find({ _id: { $in: lines.map((row) => row.refId) }, deletedAt: null }, { session }).toArray();
    const ids = modules.flatMap((module) => ((module.workTypes ?? []) as ModuleRoute[]).map((kind) => kind.workTypeId));
    const types = await this.db.collection('worktypes').find({ _id: { $in: ids }, deletedAt: null }, { session, projection: { name: 1 } }).toArray();
    const names = new Map(types.map((kind) => [String(kind._id), String(kind.name ?? '').trim()]));
    return new Map(modules.map((module) => {
      const workTypes = ((module.workTypes ?? []) as ModuleRoute[]).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const work = workTypes.map((kind): WorkStep | null => {
        const name = names.get(String(kind.workTypeId));
        return name ? { workTypeId: kind.workTypeId, name, ...(kind.estimatedHours != null ? { hours: kind.estimatedHours } : {}) } : null;
      });
      return [String(module._id), { module, work, usable: work.length > 0 && work.every(Boolean) }] as const;
    }));
  }

  private stamp(line: CatalogLine, module: Record<string, unknown>, work: Array<WorkStep | null>) {
    return legalHash({ refId: line.refId, quantity: line.quantity, unit: line.unit, dimensions: line.overrideDimensions, work, materials: module.materials, composition: module.composition, name: module.name, article: module.article });
  }

  async list(designId: string) {
    const { design, line, product, comp } = await this.context(designId);
    const order = line?.orderId ? await this.db.collection('salesorders').findOne({ _id: line.orderId }, { projection: { activeArchiveVersion: 1, deletedAt: 1, stage: 1 } }) : null;
    const jobs = line ? await this.tasks.find({ incomeId: line._id, deletedAt: null, status: { $ne: 'cancelled' } }, { moduleWork: 1, seq: 1, status: 1, openIncomeId: 1 }).lean().exec() : [];
    const modules = await this.moduleRoutes(comp);
    const ready = new Map(((design.moduleReady ?? []) as Ready[]).map((item) => [item.lineId, item.stamp]));
    const full = jobs.some((job) => !job.moduleWork);
    return {
      editable: !!order && !order.activeArchiveVersion && !order.deletedAt && order.stage !== 'cancelled' && !full && design.status !== 'cancelled',
      productId: product ? String(product._id) : null,
      legacyComposition: !!product?.productModuleIds?.length && !product.composition?.length,
      items: comp.map((row) => {
        const info = modules.get(String(row.refId));
        const job = jobs.find((task) => same(task.moduleWork?.lineId, row._id));
        return { lineId: String(row._id), ready: !!info?.usable && ready.get(String(row._id)) === this.stamp(row, info.module, info.work),
          hasRoute: !!info?.usable, task: job ? { id: String(job._id), code: 'W-' + job.seq, status: job.status } : null };
      }),
    };
  }

  private async writable(designId: string, lineId: string, session: ClientSession) {
    const { design, line, product, comp } = await this.context(designId, session);
    if (!line?.orderId || !product) throw new BadRequestException('Сопоставьте действующую позицию заказа с изделием');
    if (design.status === 'cancelled') throw new ConflictException('Задача проектирования отменена');
    await claimWritableOrders(this.db, session, [line.orderId]);
    const order = await this.db.collection('salesorders').findOne({ _id: line.orderId, deletedAt: null }, { session, projection: { stage: 1 } });
    if (!order || order.stage === 'cancelled') throw new ConflictException('Договор отменён');
    const requested = oid(lineId, 'строки модуля');
    const row = comp.find((item) => same(item._id, requested));
    if (!row) throw new NotFoundException('Модуля нет в составе этого изделия');
    const info = (await this.moduleRoutes([row], session)).get(String(row.refId));
    if (!info) throw new NotFoundException('Модуль удалён из каталога');
    const full = await this.tasks.exists({ incomeId: line._id, moduleWork: null, deletedAt: null, status: { $ne: 'cancelled' } }).session(session);
    if (full) throw new ConflictException('По позиции уже запущено целое изделие');
    return { design, line, product, row, info, stamp: this.stamp(row, info.module, info.work), key: moduleWorkKey(line._id, row._id) };
  }

  async setReady(designId: string, lineId: string, ready: boolean) {
    await withOrderWrite(this.connection, [], async (session) => {
      const ctx = await this.writable(designId, lineId, session);
      if (await this.tasks.exists({ moduleKey: ctx.key, deletedAt: null }).session(session)) throw new ConflictException('Модуль уже передан в работу');
      if (ready && !ctx.info.usable) throw new BadRequestException('Добавьте действующие виды работ модуля');
      const rows = ((ctx.design.moduleReady ?? []) as Ready[]).filter((item) => item.lineId !== lineId);
      if (ready) rows.push({ lineId, stamp: ctx.stamp });
      await this.db.collection('designtasks').updateOne({ _id: ctx.design._id }, { $set: { moduleReady: rows } }, { session });
    });
    return this.list(designId);
  }

  async compose(designId: string, dto: import('./dto/work.dto').DesignCompositionDto, organizationId?: string) {
    return withOrderWrite(this.connection, [], async (session) => {
      const { design, line, product, comp } = await this.context(designId, session);
      if (!product || (organizationId && product.organizationId && !same(organizationId, product.organizationId))) throw new NotFoundException('Изделие не найдено');
      if (design.status === 'cancelled') throw new ConflictException('Задача проектирования отменена');
      await claimWritableOrders(this.db, session, [line?.orderId, design.orderId]);
      const parent = async (id?: string) => {
        if (!id) return { collection: 'products', id: product._id, lines: (product.composition ?? []) as CatalogLine[],
          legacy: () => storedProductModuleLines(product.productModuleIds) };
        if (!comp.some((row) => same(row.refId, id))) throw new NotFoundException('Модуль не входит в состав изделия');
        const doc = await this.db.collection('productmodules').findOne({ _id: oid(id, 'модуля'), deletedAt: null }, { session });
        if (!doc) throw new NotFoundException('Модуль не найден');
        const lines = (doc.composition ?? []) as CatalogLine[];
        return { collection: 'productmodules', id: doc._id, lines, legacy: () => storedModuleMaterialLines(doc.materials) };
      };
      const save = (owner: { collection: string; id: Types.ObjectId }, lines: CatalogLine[]) =>
        owner.collection === 'products'
          ? saveReleasedProductComposition(this.db, owner.id, lines, session)
          : this.db.collection(owner.collection).updateOne({ _id: owner.id }, { $set: { composition: lines, updatedAt: new Date() }, $inc: { __v: 1 } }, { session });
      const from = await parent(dto.fromModuleId);
      if (dto.action === 'materialize') {
        if (!from.lines.length) {
          const initial = from.legacy();
          if (initial.length) await save(from, initial);
        }
      } else if (dto.action === 'reorder') {
        const ids = dto.order ?? [];
        const lines = new Map(from.lines.map((row) => [String(row._id), row]));
        if (new Set(ids).size !== lines.size || ids.length !== from.lines.length || ids.some((id) => !lines.has(id))) {
          throw new ConflictException('Состав изменился. Обновите его и повторите перестановку.');
        }
        await save(from, ids.map((id, sortOrder) => ({ ...lines.get(id)!, sortOrder })));
      } else {
        if (!dto.lineId || same(dto.fromModuleId, dto.toModuleId)) throw new BadRequestException('Укажите деталь и другое место в составе');
        const to = await parent(dto.toModuleId);
        if (!to.lines.length && to.legacy().length) throw new ConflictException('Сначала сохраните старый состав места назначения');
        if (from.lines.length === 1 && from.legacy().some((item) => same(item.refId, from.lines[0].refId))) {
          throw new ConflictException('Последняя строка также есть в старом составе CRM. Перенос этой строки требует сверки каталога.');
        }
        const row = from.lines.find((item) => same(item._id, dto.lineId));
        if (!row || row.lineType !== 'material' || !await this.db.collection('materials').findOne({ _id: row.refId, materialKind: 'part', deletedAt: null }, { session, projection: { _id: 1 } })) {
          throw new NotFoundException('В этом месте нет такой детали');
        }
        if (to.lines.some((item) => item.lineType === 'material' && same(item.refId, row.refId))) throw new ConflictException('Деталь уже есть в выбранном составе. Измените её количество отдельно.');
        const sortOrder = Math.max(-1, ...to.lines.map((item) => item.sortOrder ?? 0)) + 1;
        await save(from, from.lines.filter((item) => !same(item._id, row._id)));
        await save(to, [...to.lines, { ...row, sortOrder }]);
      }
      return { ok: true };
    });
  }

  private async snapshotLines(module: Record<string, unknown>, session: ClientSession) {
    const lines = ((module.composition ?? []) as CatalogLine[]).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const source = lines.length ? lines : storedModuleMaterialLines(module.materials as Parameters<typeof storedModuleMaterialLines>[0]);
    const types = ['module', 'material'] as const;
    const names = new Map<string, string>();
    for (const type of types) {
      const ids = source.filter((line) => line.lineType === type).map((line) => line.refId);
      if (!ids.length) continue;
      const catalog = await this.db.collection(type === 'module' ? 'productmodules' : 'materials').find({ _id: { $in: ids } }, { session, projection: { name: 1 } }).toArray();
      for (const item of catalog) names.set(type + ':' + String(item._id), String(item.name));
    }
    return source.map((line) => ({
      refId: line.refId, type: line.lineType, name: names.get(line.lineType + ':' + String(line.refId)) || 'Позиция каталога',
      quantity: Number(line.quantity), unit: line.unit || 'шт',
    }));
  }

  async launch(designId: string, lineId: string, userId?: string) {
    return withOrderWrite(this.connection, [], async (session) => {
      const ctx = await this.writable(designId, lineId, session);
      const existing = await this.tasks.findOne({ moduleKey: ctx.key, deletedAt: null }, { _id: 1 }, { session }).lean().exec();
      if (existing) return String(existing._id);
      const ready = ((ctx.design.moduleReady ?? []) as Ready[]).find((item) => item.lineId === lineId);
      if (!ready || ready.stamp !== ctx.stamp || !ctx.info.usable) throw new ConflictException('Проверьте состав и маршрут и снова отметьте готовность модуля');
      const quantity = Number(ctx.line.qty) * Number(ctx.row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Укажите количество позиции и модуля больше нуля');
      const route = ctx.info.work.filter((step): step is WorkStep => step !== null);
      const by = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
      const now = new Date();
      const seq = await this.counters.nextSeq('WorkTask', 'W', session);
      const [task] = await this.tasks.create([{
        seq, incomeId: ctx.line._id, orderId: ctx.line.orderId, productId: ctx.product._id,
        moduleKey: ctx.key,
        moduleWork: { lineId: ctx.row._id, moduleId: ctx.row.refId, designTaskId: ctx.design._id, designCode: 'D-' + ctx.design.seq,
          name: ctx.info.module.name, article: ctx.info.module.article, quantity, items: await this.snapshotLines(ctx.info.module, session) },
        route, ...positionAt(route, 0), startedAt: now, createdBy: by, moves: [{ at: now, by, from: null, to: 0 }],
      }], { session });
      return String(task._id);
    });
  }
}
