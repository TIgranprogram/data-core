import { Types, type mongo } from 'mongoose';
import { GAP_OPENS, GAP_WEIGHT, PRODUCT_ITEMS, type FillTarget } from './product-fill-weights';
import type { GapItem } from './passport-gaps';
import { TECH_ONLY_KEYS, TECH_PROJECTION, techSheetGaps } from './techsheet-gaps';

export interface FillItem {
  key: string; label: string; kind: GapItem['kind'] | 'product'; target: FillTarget; weight: number; required: boolean; opens: string; urgent: boolean;
}
export interface FillQueue {
  /** Заполнено / всего применимых (пункты с умолчанием в счёт не идут — они уже подставлены). */
  done: number; total: number;
  /** Очередь пустых пунктов: что заполнить первым — в начале. */
  items: FillItem[];
  /** Очередь собрана только по паспорту: проверки техописания пока нет. */
  /** passport+techsheet — учтены и пробелы техописания (materials, parts). */
  scope: 'passport' | 'passport+techsheet';
  /** Сколько пунктов осталось техописанию — то же число, что «Осталось N» во вкладке (GET techsheet-gaps); только при passport+techsheet. */
  techsheetLeft?: number;
}

export interface FillInput {
  gaps: GapItem[];
  product: Record<string, unknown>;
  /** Изделие стоит в открытых заказах (вес × 2) или по нему уже есть выпущенные паспорта (× 1,5). */
  inOrders: boolean;
  hasIssued: boolean;
  /** Добавить пробелы техописания (материалы, части). Без флага — только паспорт. */
  withTechsheet?: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Пустые пункты изделия вне паспортных пробелов (чистая функция). */
function productEmpty(p: Record<string, unknown>): Set<string> {
  const d = (p.dimensions ?? {}) as Record<string, unknown>;
  const empty = new Set<string>();
  if (!num(d.length) || !num(d.width) || !num(d.height)) empty.add('dimensions');
  if (!num(p.weightKg)) empty.add('weightKg');
  if (!Array.isArray(p.composition) || !p.composition.length) empty.add('composition');
  if (!String(p.installation ?? '').trim()) empty.add('installation');
  return empty;
}

/**
 * Очередь «что заполнить первым» (C114 J, H-REPORT п.3): паспортные пробелы + габариты/вес/состав/монтаж изделия.
 * Порядок: тип паспорта первым, затем обязательные, затем по весу (× срочность), при равных — как в воронке паспорта.
 * Один источник пробелов паспорта — `productGaps`; своих правил здесь нет.
 */
export function buildFillQueue(input: FillInput): FillQueue {
  const mult = (input.inOrders ? 2 : 1) * (input.hasIssued ? 1.5 : 1);
  const urgent = mult > 1;
  const open = input.gaps.filter((g) => !g.defaulted);
  const gapKeys = new Set(open.map((g) => g.key));
  const items: Array<FillItem & { score: number; at: number }> = open.map((g, at) => {
    const weight = GAP_WEIGHT[g.kind] ?? 1;
    return { key: g.key, label: g.label, kind: g.kind, target: 'passport' as const, weight, required: g.required, opens: GAP_OPENS[g.kind] ?? '', urgent, score: weight * mult, at };
  });
  const empty = productEmpty(input.product);
  let applicable = PRODUCT_ITEMS.length;
  PRODUCT_ITEMS.forEach((it, i) => {
    // поле уже спрашивает паспорт — не дублируем (оно в счёт идёт один раз, через пробел паспорта)
    if (it.covers.some((k) => gapKeys.has(k))) { applicable--; return; }
    if (empty.has(it.key)) items.push({ key: it.key, label: it.label, kind: 'product', target: it.target, weight: it.weight, required: false, opens: it.opens, urgent, score: it.weight * mult, at: open.length + i });
  });
  if (input.withTechsheet) {
    for (const g of techSheetGaps(input.product).filter((x) => TECH_ONLY_KEYS.includes(x.key))) {
      // материалы паспорт уже спрашивает (они и есть материалы техописания) — один пункт, не два
      if (gapKeys.has(g.key) || (g.key === 'materials' && [...gapKeys].some((k) => /^material/i.test(k)))) continue;
      applicable++;
      items.push({ key: g.key, label: g.label, kind: 'product', target: 'techsheet', weight: g.weight, required: g.required, opens: g.opens, urgent, score: g.weight * mult, at: open.length + PRODUCT_ITEMS.length + items.length });
    }
  }
  items.sort((a, b) => Number(b.kind === 'category') - Number(a.kind === 'category') || Number(b.required) - Number(a.required) || b.score - a.score || a.at - b.at);
  const total = applicable + open.length;
  return { done: Math.max(0, total - items.length), total, items: items.map((i) => ({ key: i.key, label: i.label, kind: i.kind, target: i.target, weight: i.weight, required: i.required, opens: i.opens, urgent: i.urgent })), scope: input.withTechsheet ? 'passport+techsheet' : 'passport', ...(input.withTechsheet ? { techsheetLeft: techSheetGaps(input.product).length } : {}) };
}

/** Данные изделия и его связи для очереди: сам документ, участие в заказах, выпущенные паспорта. */
export async function loadFillContext(db: mongo.Db, productId: string): Promise<Pick<FillInput, 'product' | 'inOrders' | 'hasIssued'>> {
  const _id = new Types.ObjectId(productId);
  const product = (await db.collection('products').findOne({ _id, deletedAt: null }, { projection: { ...TECH_PROJECTION, composition: 1 } })) ?? {};
  const [line, issued] = await Promise.all([
    db.collection('incomes').findOne({ productId: _id, deletedAt: null, cancelledAt: null, orderId: { $ne: null } }, { projection: { _id: 1 } }),
    db.collection('productpassports').findOne({ productId: _id, deletedAt: null, status: 'issued' }, { projection: { _id: 1 } }),
  ]);
  return { product, inOrders: !!line, hasIssued: !!issued };
}
