import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import type { RouteDto } from './dto/work.dto';
import type { WorkStep } from './work-task.schema';

type Doc = Record<string, unknown>;
type Stored = { workTypeId: Types.ObjectId; lineId?: Types.ObjectId; note?: string };

/**
 * Маршрут изделия — `products.workTypes[]` (необязательное поле в общей с CRM коллекции; порядок массива = порядок работ).
 * Маршрут модуля (`productmodules.workTypes`) только читается — как подсказка. Пишем сырой коллекцией, остальные поля изделия не трогаем.
 */
@Injectable()
export class WorkRouteService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() { return this.connection.db!; }

  private async product(productId: string) {
    const p = await this.db().collection('products').findOne({ _id: oid(productId, 'изделия'), deletedAt: null }, { projection: { name: 1, sku: 1, workTypes: 1, composition: 1, productModuleIds: 1 } });
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
      .map((w) => ({ workTypeId: w.workTypeId, name: name.get(String(w.workTypeId))!, ...(w.lineId ? { lineId: w.lineId } : {}), ...(w.note ? { note: w.note } : {}) }))]));
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
    const comp = (p.composition as Array<{ _id: Types.ObjectId; lineType: string; refId: Types.ObjectId }> | undefined) ?? [];
    const names = new Map<string, string>();
    for (const [type, coll] of [['module', 'productmodules'], ['material', 'materials'], ['product', 'products']] as const) {
      const ids = comp.filter((l) => l.lineType === type).map((l) => l.refId);
      if (ids.length) for (const r of await this.db().collection(coll).find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()) names.set(String(r._id), String(r.name ?? ''));
    }
    return {
      productId: String(p._id), name: (p.name as string | undefined) ?? null, sku: (p.sku as string | undefined) ?? null,
      hasRoute: steps.length > 0,
      note: steps.length ? null : 'Не задано, как делается',
      steps: steps.map((s, i) => ({ index: i, workTypeId: String(s.workTypeId), name: s.name, lineId: s.lineId ? String(s.lineId) : null, note: s.note ?? null })),
      // в базе остались шаги удалённых видов работ — их не показываем, но предупреждаем
      droppedSteps: stored.length - steps.length,
      parts: comp.map((l) => ({ id: String(l._id), lineType: l.lineType, name: names.get(String(l.refId)) ?? '' })),
      suggested: steps.length ? [] : await this.suggest(p),
    };
  }

  /** Записать маршрут целиком (пустой список — убрать). Повтор вида работ в одном маршруте — 400. */
  async set(productId: string, dto: RouteDto) {
    const p = await this.product(productId);
    const ids = dto.steps.map((s) => oid(s.workTypeId, 'вида работ'));
    const types = ids.length ? await this.db().collection('worktypes').find({ _id: { $in: ids }, deletedAt: null }, { projection: { name: 1 } }).toArray() : [];
    const name = new Map(types.map((t) => [String(t._id), String(t.name ?? '')]));
    const seen = new Set<string>();
    ids.forEach((id) => {
      const key = String(id);
      if (!name.has(key)) throw new BadRequestException('Вид работ не найден — выберите из справочника');
      if (seen.has(key)) throw new BadRequestException(`Вид работ «${name.get(key)}» уже есть в маршруте`);
      seen.add(key);
    });
    const parts = new Set(((p.composition as Array<{ _id: Types.ObjectId }> | undefined) ?? []).map((l) => String(l._id)));
    const workTypes: Stored[] = dto.steps.map((s, i) => {
      if (s.lineId && !parts.has(s.lineId)) throw new BadRequestException('Часть состава не из этого изделия');
      const note = s.note?.trim();
      return { workTypeId: ids[i], ...(s.lineId ? { lineId: new Types.ObjectId(s.lineId) } : {}), ...(note ? { note } : {}) };
    });
    await this.db().collection('products').updateOne({ _id: p._id as Types.ObjectId }, workTypes.length ? { $set: { workTypes, updatedAt: new Date() } } : { $unset: { workTypes: '' }, $set: { updatedAt: new Date() } });
    return this.get(productId);
  }
}
