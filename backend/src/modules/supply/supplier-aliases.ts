import type { Connection } from 'mongoose';
import { normSearch } from '../../common/text/search-norm';

/**
 * «Как называется у поставщика» (TASKS МВ.2, решение 2026-10-21): пара «поставщик + его название / артикул → наша позиция».
 * Копится сама: при внесении заявок из таблицы (Заявки → «+ Из таблицы», «+ Счёт») приложение запоминает,
 * что строка поставщика = наша позиция. В следующий раз то же название от того же поставщика находится точно.
 * Коллекция data-core `supplier_aliases` (CRM её не знает). Поставщик не указан — пара общая («*»).
 */
export interface AliasPair { extName?: string; extArticle?: string; title: string; unit?: string; categoryName?: string; article?: string }
export interface AliasHit { title: string; unit?: string; categoryName?: string; article?: string; by: 'alias' }

const COLL = 'supplier_aliases';
const sup = (s?: string) => normSearch(s || '') || '*';
const key = (s?: string) => normSearch(s || '').replace(/\s+/g, '');

export class SupplierAliases {
  constructor(private readonly connection: Connection) {}
  private get coll() { return this.connection.db!.collection(COLL); }

  /** Запомнить пары (повтор — обновляет и считает, сколько раз пригодилось). */
  async remember(supplierName: string | undefined, pairs: AliasPair[]) {
    const s = sup(supplierName);
    let n = 0;
    for (const p of pairs) {
      const title = String(p.title || '').trim();
      const nameK = key(p.extName), artK = key(p.extArticle);
      if (!title || (!nameK && !artK)) continue;
      // своё же название — запоминать незачем, если артикула нет
      if (!artK && nameK === key(title)) continue;
      const set = { supplier: s, supplierName: supplierName || null, title, unit: p.unit || null, categoryName: p.categoryName || null, article: p.article || null, extName: p.extName || null, extArticle: p.extArticle || null, updatedAt: new Date() };
      const filter = artK ? { supplier: s, artKey: artK } : { supplier: s, nameKey: nameK };
      await this.coll.updateOne(filter, { $set: { ...set, nameKey: nameK || null, artKey: artK || null }, $inc: { uses: 1 }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      n++;
    }
    return { saved: n };
  }

  /** Найти наши позиции для строк поставщика: сначала у этого поставщика, потом общие. */
  async match(supplierName: string | undefined, lines: Array<{ name?: string; article?: string }>): Promise<Array<AliasHit | null>> {
    const s = sup(supplierName);
    const arts = lines.map((l) => key(l.article)).filter(Boolean);
    const names = lines.map((l) => key(l.name)).filter(Boolean);
    if (!arts.length && !names.length) return lines.map(() => null);
    const docs = await this.coll.find({ supplier: { $in: [s, '*'] }, $or: [{ artKey: { $in: arts } }, { nameKey: { $in: names } }] }).toArray();
    const pick = (f: (d: Record<string, unknown>) => boolean) => docs.filter(f).sort((a, b) => (a.supplier === s ? -1 : 1) - (b.supplier === s ? -1 : 1))[0];
    return lines.map((l) => {
      const a = key(l.article), nm = key(l.name);
      const d = (a && pick((x) => x.artKey === a)) || (nm && pick((x) => x.nameKey === nm));
      return d ? { title: String(d.title), unit: (d.unit as string) || undefined, categoryName: (d.categoryName as string) || undefined, article: (d.article as string) || undefined, by: 'alias' } : null;
    });
  }
}
