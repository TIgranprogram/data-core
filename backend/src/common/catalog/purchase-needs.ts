/** «Что купить» по изделию (C057-Э1 п. 5): чистые расчёты над деревом состава и остатками, без обращений к базе. */

export interface NeedsTreeNode { _id: string; kind: string; quantity: number; children: NeedsTreeNode[] }

export interface NeedsMaterial {
  id: string;
  name: string;
  article?: string;
  unit?: string;
  materialKind?: string | null;
  stockQty?: number;
  isProfile?: boolean;
  scrapFactor?: number;
  isDefaultFormat?: boolean;
  profileId?: string;
  dimensions?: Array<{ type: string; value: number }>;
}

export interface NeedsItem {
  materialId: string;
  name: string;
  kind: string;
  unit: string;
  need: number;
  have: number;
  buy: number;
  buyUnit: string;
  format?: { id: string; name: string };
  note?: string;
}

export interface NeedsResult { items: NeedsItem[]; missingBlank: Array<{ id: string; article: string; name: string }> }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const KIND_ORDER: Record<string, number> = { raw: 0, fastener: 1, purchased: 2 };

/** Сколько каждой позиции нужно на `qty` изделий (умножение количеств по пути) и какие детали имеют строку сырья. */
export function flattenNeeds(tree: NeedsTreeNode, qty: number): { totals: Map<string, number>; parts: Map<string, boolean> } {
  const totals = new Map<string, number>();
  const parts = new Map<string, boolean>();
  const walk = (node: NeedsTreeNode, mult: number) => {
    for (const child of node.children) {
      const m = mult * (Number(child.quantity) || 0);
      if (child.kind === 'material') {
        totals.set(child._id, (totals.get(child._id) ?? 0) + m);
        parts.set(child._id, !!parts.get(child._id) || child.children.length > 0);
      }
      walk(child, m);
    }
  };
  walk(tree, qty);
  return { totals, parts };
}

/** Размер одного формата в единице сортамента: м² (длина × ширина) или м (длина); `0` — размера нет. */
export function formatSize(m: NeedsMaterial, unit: string): number {
  const dim = (t: string) => m.dimensions?.find((d) => d.type === t)?.value ?? 0;
  return unit === 'м²' ? round6((dim('length') * dim('width')) / 1e6) : round6(dim('length') / 1000);
}

function profileItem(profile: NeedsMaterial, total: number, formats: NeedsMaterial[]): NeedsItem {
  const unit = profile.unit || 'м²';
  const need = round6(total * Math.max(1, profile.scrapFactor ?? 1));
  const sized = formats.map((f) => ({ f, size: formatSize(f, unit) })).filter((x) => x.size > 0);
  const have = round6(sized.reduce((s, x) => s + Math.max(0, x.f.stockQty ?? 0) * x.size, 0));
  const short = round6(Math.max(0, need - have));
  const base: NeedsItem = { materialId: profile.id, name: profile.name, kind: 'raw', unit, need, have, buy: short, buyUnit: unit };
  const pick = sized.find((x) => x.f.isDefaultFormat) ?? sized[0];
  if (!pick) return { ...base, note: formats.length ? 'У формата нет размеров — покупка в ' + unit : 'Нет формата на складе — покупка в ' + unit };
  return { ...base, buy: Math.ceil(round6(short / pick.size)), buyUnit: 'шт', format: { id: pick.f.id, name: pick.f.name } };
}

/** Итоговый список: сортаменты (× отходы, − остатки форматов, → штуки основного формата), метизы и покупные; детали без заготовки — отдельно. */
export function computeNeeds(totals: Map<string, number>, parts: Map<string, boolean>, materials: Map<string, NeedsMaterial>, formats: NeedsMaterial[]): NeedsResult {
  const items: NeedsItem[] = [];
  const missingBlank: NeedsResult['missingBlank'] = [];
  for (const [id, total] of totals) {
    const m = materials.get(id);
    if (!m || total <= 0) continue;
    if (m.materialKind === 'part') {
      if (!parts.get(id)) missingBlank.push({ id, article: m.article ?? '', name: m.name });
    } else if (m.isProfile) {
      items.push(profileItem(m, total, formats.filter((f) => f.profileId === id)));
    } else {
      const have = round6(Math.max(0, m.stockQty ?? 0));
      const need = round6(total);
      const unit = m.unit || 'шт';
      items.push({ materialId: id, name: m.name, kind: m.materialKind || 'other', unit, need, have, buy: round6(Math.max(0, need - have)), buyUnit: unit });
    }
  }
  items.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name, 'ru'));
  missingBlank.sort((a, b) => a.article.localeCompare(b.article));
  return { items, missingBlank };
}
