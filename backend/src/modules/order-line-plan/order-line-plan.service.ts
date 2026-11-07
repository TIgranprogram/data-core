import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import type { WorkStep } from '../../common/work-step';
import {
  diffRows, normalizeRows, productFields, rowsFromProduct, setChecked, WHOLE_PRODUCT,
  type PartIn, type PartRow, type PlanDiff, type StepRow,
} from '../../common/work-route-rows';
import type { ApplyToProductDto, CheckDto, SavePlanDto } from './dto/order-line-plan.dto';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Income { _id: Types.ObjectId; productId?: Types.ObjectId | null }

export const PARTS_DICT = 'productParts';
/** Части по умолчанию, пока справочник пуст. */
const DEFAULT_PARTS = ['Стойки', 'Навес', 'Наполнение', 'Основание'];
const idOf = (v: unknown) => (v ? String(v) : null);
const ms = (d: unknown) => (d instanceof Date ? d.getTime() : d ? new Date(d as string).getTime() : null);

/**
 * План позиции заказа (C041 Э1): части и виды работ позиции, скопированные из изделия, с отметкой «Проверено».
 * Создаётся лениво при первом чтении (upsert по уникальному `incomeId` — гонка безопасна), правится с `rev`,
 * переносится в изделие одним вызовом (с проверкой, что изделие не менялось). Запуск «В работе» берёт шаги отсюда.
 */
@Injectable()
export class OrderLinePlanService implements OnModuleInit {
  private readonly log = new Logger(OrderLinePlanService.name);
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() { return this.connection.db!; }
  private plans() { return this.db().collection('orderlineplans'); }
  private by(userId?: string) { return userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined; }

  /** Справочник «Части изделия (для работ)»: пока пуст — заводим стойки, навес, наполнение, основание. */
  async onModuleInit() {
    try {
      const dict = this.db().collection('dict_values');
      if (await dict.countDocuments({ dict: PARTS_DICT }, { limit: 1 })) return;
      const now = new Date();
      await dict.insertMany(DEFAULT_PARTS.map((name, i) => ({ dict: PARTS_DICT, name, sortOrder: String(i + 1), deletedAt: null, createdAt: now, updatedAt: now })));
    } catch (e) {
      this.log.warn(`Части изделия по умолчанию не заведены: ${(e as Error).message}`);
    }
  }

  private async income(incomeId: string): Promise<Income> {
    const inc = await this.db().collection('incomes').findOne({ _id: oid(incomeId, 'позиции'), deletedAt: null }, { projection: { productId: 1 } });
    if (!inc) throw new NotFoundException('Позиция заказа не найдена');
    return inc as unknown as Income;
  }

  private async product(productId: Types.ObjectId | null | undefined): Promise<Doc | null> {
    if (!productId) return null;
    return (await this.db().collection('products').findOne({ _id: productId, deletedAt: null }, { projection: { name: 1, sku: 1, updatedAt: 1, parts: 1, workTypes: 1 } })) as Doc | null;
  }

  /** Названия видов работ (только живые) по списку id. */
  private async typeNames(ids: unknown[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean).map(String))].filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new Types.ObjectId(x));
    if (!uniq.length) return new Map();
    const rows = await this.db().collection('worktypes').find({ _id: { $in: uniq }, deletedAt: null }, { projection: { name: 1 } }).toArray();
    return new Map(rows.map((t) => [String(t._id), String(t.name ?? '')]));
  }

  private async rowsOf(prod: Doc | null) {
    return prod ? rowsFromProduct(prod, await this.typeNames(((prod.workTypes as Doc[] | undefined) ?? []).map((w) => w.workTypeId))) : { parts: [], steps: [] };
  }

  /** План позиции: есть — отдаём, нет — копия из изделия (нет изделия — пустой ручной). */
  async ensure(inc: Income): Promise<Doc> {
    const found = await this.plans().findOne({ incomeId: inc._id });
    if (found) return found as Doc;
    const prod = await this.product(inc.productId);
    const rows = await this.rowsOf(prod);
    const now = new Date();
    await this.plans().updateOne({ incomeId: inc._id }, {
      $setOnInsert: { incomeId: inc._id, productId: prod ? prod._id : null, origin: prod ? 'product' : 'manual', rev: 1, ...rows, productRevAtCopy: prod?.updatedAt ?? null, deletedAt: null, createdAt: now, updatedAt: now },
    }, { upsert: true });
    return (await this.plans().findOne({ incomeId: inc._id }))! as Doc;
  }

  private async findPlan(id: string): Promise<Doc> {
    const plan = await this.plans().findOne({ _id: oid(id, 'плана'), deletedAt: null });
    if (!plan) throw new NotFoundException('План не найден');
    return plan as Doc;
  }

  /** Позиция плана жива (не в корзине) — иначе план не читаем и не правим. */
  private async incomeOf(plan: Doc): Promise<Income> {
    return this.income(String(plan.incomeId));
  }

  /** Ответ по контракту: названия, «Изделие целиком», сравнение с изделием, задание «В работе». */
  private async present(plan: Doc, inc: Income) {
    const parts = (plan.parts as PartRow[]) ?? [], steps = (plan.steps as StepRow[]) ?? [];
    const prod = await this.product(inc.productId);
    const [names, base, users, task] = await Promise.all([
      this.typeNames(steps.map((s) => s.workTypeId)),
      this.rowsOf(prod),
      this.userNames([...parts, ...steps].map((r) => r.checkedBy)),
      this.db().collection('worktasks').find({ incomeId: inc._id, deletedAt: null }, { projection: { status: 1 } }).sort({ createdAt: -1 }).limit(1).toArray(),
    ]);
    const partName = new Map(parts.map((p) => [String(p._id), p.name]));
    const who = (r: { checkedBy?: Types.ObjectId }) => (r.checkedBy ? users.get(String(r.checkedBy)) ?? null : null);
    const sameProduct = idOf(plan.productId) === idOf(inc.productId);
    const copyAt = ms(plan.productRevAtCopy), nowAt = ms(prod?.updatedAt);
    const diff: PlanDiff = prod && sameProduct ? diffRows({ parts, steps }, base) : { changed: false, added: 0, removed: 0, edited: 0 };
    return {
      id: String(plan._id), incomeId: String(plan.incomeId), productId: idOf(inc.productId), productName: prod ? String(prod.name ?? '') : null,
      rev: plan.rev as number, origin: plan.origin as string, launchedAt: plan.launchedAt ?? null,
      parts: parts.map((p) => ({ id: String(p._id), partId: idOf(p.partId), name: p.name, qty: p.qty, checked: !!p.checked, checkedByName: who(p), checkedAt: p.checkedAt ?? null })),
      steps: steps.filter((s) => names.has(String(s.workTypeId))).map((s) => ({
        id: String(s._id), workTypeId: String(s.workTypeId), workTypeName: names.get(String(s.workTypeId))!,
        partRowId: idOf(s.partRowId), partName: s.partRowId ? partName.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT,
        hours: s.hours ?? null, note: s.note ?? null, checked: !!s.checked, checkedByName: who(s), checkedAt: s.checkedAt ?? null,
        assigneeId: idOf(s.assigneeId), plan: s.plan ?? null,
      })),
      diff,
      // изделие сменили у позиции или изменили после копии — предложить «Взять заново»
      productChangedSinceCopy: !sameProduct || (!!prod && nowAt !== null && (copyAt === null || nowAt > copyAt)),
      productUpdatedAt: prod?.updatedAt ?? null,
      changedAfterLaunch: !!plan.launchedAt && ms(plan.updatedAt)! > ms(plan.launchedAt)!,
      ...(task[0] ? { task: { id: String(task[0]._id), status: task[0].status as string } } : {}),
    };
  }

  private async userNames(ids: unknown[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    if (!uniq.length) return new Map();
    const rows = await this.db().collection('users').find({ _id: { $in: uniq } }, { projection: { displayName: 1, fullName: 1, username: 1 } }).toArray();
    return new Map(rows.map((u) => [String(u._id), String(u.displayName || u.fullName || u.username || '')]));
  }

  /** План позиции (создаётся из изделия при первом открытии). */
  async byIncome(incomeId: string) {
    const inc = await this.income(incomeId);
    return this.present(await this.ensure(inc), inc);
  }

  /** Названия частей из справочника: partId без имени → имя из справочника. */
  private async withDictNames(parts: SavePlanDto['parts']): Promise<PartIn[]> {
    const need = parts.filter((p) => p.partId && !p.name?.trim());
    if (!need.length) return parts;
    const rows = await this.db().collection('dict_values').find({ dict: PARTS_DICT, _id: { $in: need.map((p) => new Types.ObjectId(p.partId)) }, deletedAt: null }, { projection: { name: 1 } }).toArray();
    const name = new Map(rows.map((r) => [String(r._id), String(r.name ?? '')]));
    return parts.map((p) => {
      if (!p.partId || p.name?.trim()) return p;
      const n = name.get(p.partId);
      if (!n) throw new BadRequestException('Часть не найдена в справочнике — выберите из списка');
      return { ...p, name: n };
    });
  }

  /** Часть без записи в справочнике: найти по названию или завести (новое имя из позиции попадает в справочник). */
  private async linkDict(parts: PartRow[]): Promise<PartRow[]> {
    const dict = this.db().collection('dict_values');
    const out: PartRow[] = [];
    for (const p of parts) {
      if (p.partId) { out.push(p); continue; }
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hit = await dict.findOne({ dict: PARTS_DICT, deletedAt: null, name: new RegExp(`^\\s*${esc}\\s*$`, 'i') }, { projection: { _id: 1 } });
      if (hit) { out.push({ ...p, partId: hit._id as Types.ObjectId }); continue; }
      const now = new Date();
      const ins = await dict.insertOne({ dict: PARTS_DICT, name: p.name, deletedAt: null, createdAt: now, updatedAt: now });
      out.push({ ...p, partId: ins.insertedId });
    }
    return out;
  }

  /** Записать части и шаги целиком. Версия не совпала — 409. */
  async save(id: string, dto: SavePlanDto, userId?: string) {
    const plan = await this.findPlan(id);
    const inc = await this.incomeOf(plan);
    if (plan.rev !== dto.rev) throw new ConflictException('План изменил другой человек — обновите');
    const now = new Date();
    const parts = await this.withDictNames(dto.parts);
    const rows = normalizeRows({ parts, steps: dto.steps }, { parts: plan.parts ?? [], steps: plan.steps ?? [] }, { typeNames: await this.typeNames(dto.steps.map((s) => s.workTypeId)), by: this.by(userId), now, keepLinks: true });
    rows.parts = await this.linkDict(rows.parts);
    const res = await this.plans().updateOne({ _id: plan._id, rev: dto.rev }, { $set: { parts: rows.parts, steps: rows.steps, rev: dto.rev + 1, updatedAt: now } });
    if (!res.matchedCount) throw new ConflictException('План изменил другой человек — обновите');
    return this.present(await this.findPlan(id), inc);
  }

  /** «Проверено» у части или шага — одним касанием. */
  async check(id: string, dto: CheckDto, userId?: string) {
    const plan = await this.findPlan(id);
    const inc = await this.incomeOf(plan);
    const key = dto.kind === 'part' ? 'parts' : 'steps';
    const next = setChecked((plan[key] as Array<PartRow | StepRow>) ?? [], dto.rowId, dto.checked, { by: this.by(userId), now: new Date() });
    if (!next) throw new NotFoundException(dto.kind === 'part' ? 'Части нет в плане' : 'Работы нет в плане');
    await this.plans().updateOne({ _id: plan._id }, { $set: { [key]: next, updatedAt: new Date() }, $inc: { rev: 1 } });
    return this.present(await this.findPlan(id), inc);
  }

  /** Перенос плана в изделие (части и маршрут). Изделие менялось после того, как человек его видел, — 409. */
  async applyToProduct(id: string, dto: ApplyToProductDto) {
    const plan = await this.findPlan(id);
    const inc = await this.incomeOf(plan);
    if (!inc.productId || idOf(plan.productId) !== idOf(inc.productId)) throw new ConflictException('У позиции нет изделия или оно сменилось — нажмите «Взять заново из изделия»');
    const prod = await this.product(inc.productId);
    if (!prod) throw new NotFoundException('Изделие не найдено');
    const current = (prod.updatedAt as Date | undefined) ?? null;
    if (ms(dto.productUpdatedAt ?? null) !== ms(current)) throw new ConflictException('Изделие изменили после копии — обновите план');
    const { set, unset } = productFields(plan.parts ?? [], plan.steps ?? []);
    const stamp = new Date();
    const res = await this.db().collection('products').updateOne({ _id: prod._id, updatedAt: current }, { $set: { ...set, updatedAt: stamp }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (!res.matchedCount) throw new ConflictException('Изделие изменили после копии — обновите план');
    await this.plans().updateOne({ _id: plan._id }, { $set: { productRevAtCopy: stamp, origin: 'product', updatedAt: stamp }, $inc: { rev: 1 } });
    return { product: { id: String(prod._id), updatedAt: stamp }, plan: await this.present(await this.findPlan(id), inc) };
  }

  /** «Взять заново из изделия»: план пересобирается, отметки «Проверено» берутся из изделия. */
  async resetFromProduct(id: string) {
    const plan = await this.findPlan(id);
    const inc = await this.incomeOf(plan);
    const prod = await this.product(inc.productId);
    const rows = await this.rowsOf(prod);
    const now = new Date();
    await this.plans().updateOne({ _id: plan._id }, {
      $set: { ...rows, productId: prod ? prod._id : null, origin: prod ? 'product' : 'manual', productRevAtCopy: prod?.updatedAt ?? null, updatedAt: now },
      $inc: { rev: 1 },
    });
    return this.present(await this.findPlan(id), inc);
  }

  /**
   * Маршруты для запуска: по каждой позиции — шаги плана как снимок (`stepId`, `partName`, `hours`) и сколько работ ещё не проверено.
   * Нет плана — создаётся из изделия той же функцией. Пустые планы не попадают в ответ (запуск возьмёт общую работу).
   */
  async forLaunch(incomes: Income[]): Promise<Map<string, { steps: WorkStep[]; unchecked: number; total: number }>> {
    const out = new Map<string, { steps: WorkStep[]; unchecked: number; total: number }>();
    for (const inc of incomes) {
      const plan = await this.ensure(inc);
      const rows = (plan.steps as StepRow[]) ?? [];
      const names = await this.typeNames(rows.map((s) => s.workTypeId));
      const partName = new Map(((plan.parts as PartRow[]) ?? []).map((p) => [String(p._id), p.name]));
      const live = rows.filter((s) => names.has(String(s.workTypeId)));
      if (!live.length) continue;
      out.set(String(inc._id), {
        total: live.length, unchecked: live.filter((s) => !s.checked).length,
        steps: live.map((s): WorkStep => ({
          workTypeId: s.workTypeId, name: names.get(String(s.workTypeId))!, stepId: s._id,
          partName: s.partRowId ? partName.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT,
          ...(s.hours !== undefined ? { hours: s.hours } : {}), ...(s.lineId ? { lineId: s.lineId } : {}), ...(s.note ? { note: s.note } : {}),
        })),
      });
    }
    return out;
  }

  /** Пометить, что по планам позиций создано задание (дальше правки плана задание не меняют). */
  async markLaunched(incomeIds: Types.ObjectId[]) {
    if (!incomeIds.length) return;
    const now = new Date();
    await this.plans().updateMany({ incomeId: { $in: incomeIds } }, { $set: { launchedAt: now, updatedAt: now } });
  }
}
