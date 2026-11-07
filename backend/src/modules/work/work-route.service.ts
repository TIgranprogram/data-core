import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { normalizeRows, productFields, rowsFromProduct, WHOLE_PRODUCT, type PartRow, type StepIn, type StepRow } from '../../common/work-route-rows';
import type { RouteDto } from './dto/work.dto';
import type { WorkStep } from './work-task.schema';

type Doc = Record<string, unknown>;
type Stored = { workTypeId: Types.ObjectId; lineId?: Types.ObjectId; note?: string; partRowId?: Types.ObjectId; hours?: number; checked?: boolean };

/**
 * Маршрут изделия — `products.workTypes[]` (необязательное поле в общей с CRM коллекции; порядок массива = порядок работ), части — `products.parts[]` (C041). Шаг = вид работ × часть, нет части — «Изделие целиком».
 * Маршрут модуля (`productmodules.workTypes`) только читается — как подсказка. Пишем сырой коллекцией, остальные поля изделия не трогаем.
 */
@Injectable()
export class WorkRouteService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() { return this.connection.db!; }

  private async product(productId: string) {
    const p = await this.db().collection('products').findOne({ _id: oid(productId, 'изделия'), deletedAt: null }, { projection: { name: 1, sku: 1, workTypes: 1, parts: 1, composition: 1, productModuleIds: 1 } });
    if (!p) throw new NotFoundException('Изделие не найдено');
    return p as Doc;
  }

  /** Шаги маршрута с названиями видов работ. Удалённые виды работ пропускаются. */
  async stepsOf(products: Doc[]): Promise<Map<string, WorkStep[]>> {
    const ids = [...new Map(products.flatMap((p) => ((p.workTypes as Stored[] | undefined) ?? []).map((w) => [String(w.workTypeId), w.workTypeId] as const))).values()];
    const types = ids.length ? await this.db().collection('worktypes').find({ _id: { $in: ids }, deletedAt: null }, { projection: { name: 1 } }).toArray() : [];
    const name = new Map(types.map((t) => [String(t._id), String(t.name ?? '')]));
    return new Map(products.map((p) => [String(p._id), ((p.workTypes as Stored[] | undefined) ?? [])
      .filter((w) => name.has(String(w.workTypeId)))
      .map((w) => ({ workTypeId: w.workTypeId, name: name.get(String(w.workTypeId))!, ...(w.lineId ? { lineId: w.lineId } : {}), ...(w.note ? { note: w.note } : {}), ...(w.partRowId ? { partRowId: w.partRowId } : {}), ...(w.hours !== undefined ? { hours: w.hours } : {}), ...(w.checked ? { checked: true } : {}) }))]));
  }

  /** Подсказка из модулей изделия (только чтение): виды работ модулей по порядку, без повторов. */
  private async suggest(p: Doc): Promise<Array<{ workTypeId: string; name: string; lineId: string | null }>> {
    const lines = ((p.composition as Array<{ _id: Types.ObjectId; lineType: string; refId: Types.ObjectId; sortOrder?: number }> | undefined) ?? []).filter((l) => l.lineType === 'module').sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const legacy = ((p.productModuleIds as Types.ObjectId[] | undefined) ?? []).filter((id) => !lines.some((l) => String(l.refId) === String(id)));
    const refs = [...lines.map((l) => ({ id: l.refId, lineId: l._id as Types.ObjectId | null })), ...legacy.map((id) => ({ id, lineId: null }))];
    if (!refs.length) return [];
    const mods = await this.db().collection('productmodules').find({ _id: { $in: refs.map((r) => r.id) }, deletedAt: null }, { projection: { workTypes: 1 } }).toArray();
    const byId = new Map(mods.map((m) => [String(m._id), m as Doc]));
    const found: Array<{ workTypeId: Types.ObjectId; lineId: Types.ObjectId | null }> = [];
    for (const r of refs) {
      const wts = [...(((byId.get(String(r.id))?.workTypes as Array<{ workTypeId: Types.ObjectId; sortOrder?: number }> | undefined) ?? []))].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (const w of wts) if (!found.some((f) => String(f.workTypeId) === String(w.workTypeId))) found.push({ workTypeId: w.workTypeId, lineId: r.lineId });
    }
    const types = found.length ? await this.db().collection('worktypes').find({ _id: { $in: found.map((f) => f.workTypeId) }, deletedAt: null }, { projection: { name: 1 } }).toArray() : [];
    const name = new Map(types.map((t) => [String(t._id), String(t.name ?? '')]));
    return found.filter((f) => name.has(String(f.workTypeId))).map((f) => ({ workTypeId: String(f.workTypeId), name: name.get(String(f.workTypeId))!, lineId: f.lineId ? String(f.lineId) : null }));
  }

  /** Маршрут изделия + части состава для выбора + подсказка из модулей (когда своего маршрута нет). */
  async get(productId: string) {
    const p = await this.product(productId);
    const steps = (await this.stepsOf([p])).get(String(p._id)) ?? [];
    const stored = (p.workTypes as Stored[] | undefined) ?? [];
    const ownParts = (p.parts as PartRow[] | undefined) ?? [];
    const partNames = new Map(ownParts.map((x) => [String(x._id), x.name]));
    const comp = (p.composition as Array<{ _id: Types.ObjectId; lineType: string; refId: Types.ObjectId }> | undefined) ?? [];
    const names = new Map<string, string>();
    for (const [type, coll] of [['module', 'productmodules'], ['material', 'materials'], ['product', 'products']] as const) {
      const ids = comp.filter((l) => l.lineType === type).map((l) => l.refId);
      if (ids.length) for (const r of await this.db().collection(coll).find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()) names.set(String(r._id), String(r.name ?? ''));
    }
    return {
      productId: String(p._id), name: (p.name as string | undefined) ?? null, sku: (p.sku as string | undefined) ?? null,
      hasRoute: steps.length > 0,
      note: steps.length ? null : 'Маршрут не задан',
      steps: steps.map((s, i) => ({ index: i, workTypeId: String(s.workTypeId), name: s.name, lineId: s.lineId ? String(s.lineId) : null, note: s.note ?? null, partRowId: s.partRowId ? String(s.partRowId) : null, partName: s.partRowId ? partNames.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT, hours: s.hours ?? null, checked: !!s.checked })),
      // parts — части изделия для работ (шаги без части = «Изделие целиком»); compositionLines — строки состава (composition), к ним привязан lineId
      parts: ownParts.map((x) => ({ id: String(x._id), partId: x.partId ? String(x.partId) : null, name: x.name, qty: x.qty ?? 1, checked: !!x.checked })),
      // в базе остались шаги удалённых видов работ — их не показываем, но предупреждаем
      droppedSteps: stored.length - steps.length,
      compositionLines: comp.map((l) => ({ id: String(l._id), lineType: l.lineType, name: names.get(String(l.refId)) ?? '' })),
      suggested: steps.length ? [] : await this.suggest(p),
    };
  }

  /**
   * Записать маршрут и (если присланы) части целиком; пустой список шагов — маршрут убран. Вид работ не повторяется
   * на одной и той же части (на разных — можно). «Проверено» с прежней отметкой сохраняется, новая ставит автора.
   */
  async set(productId: string, dto: RouteDto, userId?: string) {
    const p = await this.product(productId);
    const composition = new Set(((p.composition as Array<{ _id: Types.ObjectId }> | undefined) ?? []).map((l) => String(l._id)));
    if (dto.steps.some((s) => s.lineId && !composition.has(s.lineId))) throw new BadRequestException('Часть состава не из этого изделия');
    const prev = rowsFromProduct(p, await this.typeNames(((p.workTypes as Stored[] | undefined) ?? []).map((w) => w.workTypeId)));
    const parts = dto.parts ?? prev.parts.map((x) => ({ id: String(x._id), ...(x.partId ? { partId: String(x.partId) } : {}), name: x.name, qty: x.qty, checked: x.checked }));
    const rows = normalizeRows({ parts, steps: dto.steps as StepIn[] }, prev, { typeNames: await this.typeNames(dto.steps.map((s) => s.workTypeId)), by: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined, now: new Date(), keepLinks: false });
    const { set, unset } = productFields(rows.parts, rows.steps as StepRow[]);
    await this.db().collection('products').updateOne({ _id: p._id as Types.ObjectId }, { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    return this.get(productId);
  }

  private async typeNames(ids: unknown[]) {
    const uniq = [...new Set(ids.filter(Boolean).map(String))].filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new Types.ObjectId(x));
    const types = uniq.length ? await this.db().collection('worktypes').find({ _id: { $in: uniq }, deletedAt: null }, { projection: { name: 1 } }).toArray() : [];
    return new Map(types.map((t) => [String(t._id), String(t.name ?? '')]));
  }
}
