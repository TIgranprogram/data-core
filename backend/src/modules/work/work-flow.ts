import type { Types } from 'mongoose';
import type { WorkStatus, WorkStep } from './work-task.schema';

/** Колонка общей работы «Изготовление» (изделие без маршрута). */
export const GENERIC_KEY = 'generic';
export const GENERIC_NAME = 'Изготовление';
/** Сколько дней готовое задание остаётся на доске (потом — только по фильтру «Готово»). */
export const DONE_DAYS = 7;

/** Ключ колонки шага: id вида работ или `generic`. */
export const stepKeyOf = (s: Pick<WorkStep, 'workTypeId'>) => (s.workTypeId ? String(s.workTypeId) : GENERIC_KEY);

/** Общий маршрут для изделия без своего. */
export const genericRoute = (): WorkStep[] => [{ workTypeId: null, name: GENERIC_NAME }];

/** Состояние карточки после перехода: статус, шаг и колонка. */
export interface Position { status: WorkStatus; stepIndex: number | null; stepKey: string }

/** Где карточка сейчас по её шагу (null — ждёт запуска, длина маршрута — готово). */
export function positionAt(route: WorkStep[], stepIndex: number | null): Position {
  if (stepIndex === null) return { status: 'waiting', stepIndex: null, stepKey: '' };
  if (stepIndex >= route.length) return { status: 'done', stepIndex: route.length, stepKey: '' };
  return { status: 'work', stepIndex, stepKey: stepKeyOf(route[stepIndex]) };
}

/** Следующий шаг: из «ждёт» — первый, с последнего — «готово». */
export const nextIndex = (route: WorkStep[], cur: number | null) => (cur === null ? 0 : Math.min(cur + 1, route.length));

/**
 * Колонки доски по маршрутам заданий: порядок каждого маршрута сохраняется; новый вид работ встаёт
 * сразу после предыдущего шага своего маршрута (первый шаг нового маршрута — в конец). Повторов нет.
 */
export function mergeColumns(routes: Array<Array<{ key: string; name: string }>>): Array<{ key: string; name: string }> {
  const cols: Array<{ key: string; name: string }> = [];
  for (const r of routes) {
    let at = -1;
    for (const s of r) {
      const found = cols.findIndex((c) => c.key === s.key);
      if (found >= 0) { at = found; continue; }
      at = at < 0 ? cols.length : at + 1;
      cols.splice(at, 0, { key: s.key, name: s.name });
    }
  }
  return cols;
}

export interface LaunchLine { _id: Types.ObjectId; orderId?: Types.ObjectId; lineNo?: number; title?: string; productId?: Types.ObjectId | null }
export interface LaunchProduct { _id: Types.ObjectId; routeSteps: WorkStep[] }
export interface Refusal { incomeId: string; lineNo: number | null; title: string; reason: string }

/**
 * Что делать с позициями при запуске: запустить (с маршрутом изделия или общим «Изготовление»)
 * либо отказать с понятной причиной. `open` — позиции, у которых уже есть открытое задание (код → W-N).
 */
export function planLaunch(lines: LaunchLine[], products: Map<string, LaunchProduct>, open: Map<string, number>) {
  const launch: Array<{ line: LaunchLine; route: WorkStep[]; generic: boolean }> = [];
  const refused: Refusal[] = [];
  const warnings: Array<{ incomeId: string; lineNo: number | null; text: string }> = [];
  for (const l of lines) {
    const base = { incomeId: String(l._id), lineNo: l.lineNo ?? null, title: String(l.title ?? '') };
    const seq = open.get(String(l._id));
    if (seq !== undefined) { refused.push({ ...base, reason: `Уже в работе (W-${seq})` }); continue; }
    if (!l.productId) { refused.push({ ...base, reason: 'Нет изделия — сначала сопоставьте позицию с продукцией' }); continue; }
    const p = products.get(String(l.productId));
    if (!p) { refused.push({ ...base, reason: 'Изделие не найдено или удалено — сопоставьте позицию заново' }); continue; }
    if (!p.routeSteps.length) {
      launch.push({ line: l, route: genericRoute(), generic: true });
      warnings.push({ ...base, text: 'У изделия не задано, как оно делается: запущено одной работой «Изготовление»' });
    } else launch.push({ line: l, route: p.routeSteps, generic: false });
  }
  return { launch, refused, warnings };
}
