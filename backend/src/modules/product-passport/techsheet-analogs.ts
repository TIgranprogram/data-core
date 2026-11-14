import { NotFoundException } from '@nestjs/common';
import { Types, type mongo } from 'mongoose';

/**
 * Подсказки для техописания из похожих изделий (C114, D-REPORT шаг 5).
 * Похожие — та же группа (categoryId), с заполненной таблицей материалов. Фразы назначения и монтажа — самые частые в группе.
 * Только чтение: изделие меняет менеджер, когда сам выберет подсказку.
 */
type Doc = Record<string, unknown>;
export interface Analog { id: string; sku: string; name: string; rows: number; materialsSpec: unknown }
export interface Phrase { value: string; n: number }

const str = (v: unknown) => String(v ?? '').trim();
const firstWord = (s: string) => s.toLowerCase().split(/[\s«"(,]+/).filter(Boolean)[0] ?? '';
const skuNum = (s: string) => { const m = /\d+/.exec(s); return m ? Number(m[0]) : NaN; };
const rowsOf = (p: Doc) => ((p.materialsSpec as { rows?: unknown[] } | undefined)?.rows ?? []).length;

/** Чистая функция: порядок похожих — сначала то же первое слово названия («Скамья…»), затем ближе по артикулу, затем больше строк. */
export function rankAnalogs(self: Doc, list: Doc[], limit = 5): Analog[] {
  const word = firstWord(str(self.name));
  const sku = skuNum(str(self.sku));
  return list
    .filter((p) => String(p._id) !== String(self._id) && rowsOf(p) > 0)
    .map((p) => {
      const d = skuNum(str(p.sku));
      return { p, same: word && firstWord(str(p.name)) === word ? 1 : 0, dist: Number.isFinite(sku) && Number.isFinite(d) ? Math.abs(sku - d) : 1e9 };
    })
    .sort((a, b) => b.same - a.same || a.dist - b.dist || rowsOf(b.p) - rowsOf(a.p))
    .slice(0, limit)
    .map(({ p }) => ({ id: String(p._id), sku: str(p.sku), name: str(p.name), rows: rowsOf(p), materialsSpec: p.materialsSpec }));
}

/** Чистая функция: самые частые значения поля в группе (без пустых, без учёта регистра), не больше `limit`.
 *  Фраза одного изделия не подсказывается (`min` = 2): в сборной группе она чужая (шезлонгу — про решётку дерева, стенд 14.11). */
export function topPhrases(list: Doc[], field: string, limit = 3, min = 2): Phrase[] {
  const by = new Map<string, Phrase>();
  for (const p of list) {
    const v = str(p[field]);
    if (!v) continue;
    const k = v.toLowerCase();
    const had = by.get(k);
    if (had) had.n++; else by.set(k, { value: v, n: 1 });
  }
  return [...by.values()].filter((x) => x.n >= min).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, 'ru')).slice(0, limit);
}

/** GET showcase/:id/techsheet-analogs → { analogs[], purpose[], installation[] }. Нет изделия — 404; нет группы — пустые списки. */
export async function productTechAnalogs(db: mongo.Db, productId: string) {
  if (!Types.ObjectId.isValid(productId)) throw new NotFoundException(`Изделие ${productId} не найдено`);
  const self = await db.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null }, { projection: { name: 1, sku: 1, categoryId: 1 } });
  if (!self) throw new NotFoundException(`Изделие ${productId} не найдено`);
  if (!self.categoryId) return { analogs: [], purpose: [], installation: [] };
  const group = await db.collection('products')
    .find({ categoryId: self.categoryId, deletedAt: null, _id: { $ne: self._id } }, { projection: { name: 1, sku: 1, materialsSpec: 1, purpose: 1, installation: 1 } })
    .limit(500).toArray();
  return { analogs: rankAnalogs(self, group), purpose: topPhrases(group, 'purpose'), installation: topPhrases(group, 'installation') };
}
