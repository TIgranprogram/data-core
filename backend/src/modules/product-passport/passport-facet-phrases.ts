import { Types, type mongo } from 'mongoose';
import { leavesOf, type PhraseTreeNode } from '../../common/passport/phrase-tree';

export interface FacetPhrase { id: string; name: string; section: string; text: string; facetValueIds: string[]; groupIds: string[]; byFacet: boolean }

/** Группа изделия и её родители (раздел) как набор id: привязка текста к группе действует и на изделия подгрупп. */
export async function groupChain(db: mongo.Db, categoryId: unknown): Promise<Set<string>> {
  const out = new Set<string>();
  for (let cur = categoryId ? String(categoryId) : ''; cur && !out.has(cur) && /^[a-f\d]{24}$/i.test(cur); ) {
    out.add(cur);
    const c = await db.collection('categories').findOne({ _id: new Types.ObjectId(cur) }, { projection: { parentId: 1 } });
    cur = c?.parentId ? String(c.parentId) : '';
  }
  return out;
}

/**
 * Готовые тексты для шага «Тексты» (A5): конечные варианты дерева, видимые категории. Фраза, привязанная к значениям признаков
 * (`facetValueIds`) или группам (`groupIds`), подходит изделию, если хоть одно есть у изделия (`byFacet: true`, такие — первыми).
 * Привязанная к чужим при заданном изделии не показывается; без изделия (`product === null`) показываются все.
 */
export function facetPhrases(forest: PhraseTreeNode[], bound: Map<string, string[]>, product: Set<string> | null, boundGroups: Map<string, string[]> = new Map(), productGroups: Set<string> = new Set()): FacetPhrase[] {
  const out: FacetPhrase[] = [];
  for (const root of forest) {
    for (const leaf of leavesOf(root)) {
      if (!leaf.text) continue;
      const ids = bound.get(leaf.id) ?? [];
      const gids = boundGroups.get(leaf.id) ?? [];
      const byFacet = !!product && (ids.some((x) => product.has(x)) || gids.some((x) => productGroups.has(x)));
      if (product && (ids.length || gids.length) && !byFacet) continue;
      out.push({ id: leaf.id, name: leaf.name, section: root.section, text: leaf.text, facetValueIds: ids, groupIds: gids, byFacet });
    }
  }
  return out.sort((a, b) => Number(b.byFacet) - Number(a.byFacet));
}
