import type { Doc } from './passport-consts';
import type { PhraseTreeNode, ProductCtx } from '../../common/passport/phrase-tree';
import type { PdfOrg } from './passport-pdf';
import type { PdfV2Style } from './passport-pdf-v2-types';
import type { InstallKind, InstallationPlan } from './passport-variants';
import type { LookDoc } from './passport-look.service';
import { joinRu, type PartRec } from '../../common/catalog/materials-text';
import { findIn, forProduct, leavesOf } from '../../common/passport/phrase-tree';
import type { SelectedPartsSource } from '../../common/passport/simple-description';

export const SIMPLE_DESCRIPTION_SECTION = 'simple-description';
export const isBriefPresentation = (d: Doc) => d.presentationVersion === 1 && d.variant === 'short';

export type SimpleDescriptionSource =
  | SelectedPartsSource
  | { kind: 'own'; partIds: string[] }
  | { kind: 'dictionary'; id: string; rootId: string; partIds: string[] };

export const shortDetailKeys = new Set(['materials', 'materialsSpec', 'materialIds', 'description', 'compositionSheet', 'modules']);
export const shortDetailSections = ['description', 'materials', 'materials-spec', 'composition'];
export const printPhraseRoots = (roots: PhraseTreeNode[], brief: boolean) =>
  roots.filter((r) => r.section !== SIMPLE_DESCRIPTION_SECTION && !(brief && shortDetailSections.includes(r.section)));

export function simpleDescriptionSuggestions(roots: PhraseTreeNode[]) {
  return simpleRoots(roots).flatMap((r) => leavesOf(r).map((n) => ({
    id: n.id, rootId: r.id, name: n.name, text: n.text, partIds: n.partIds ?? [],
  })));
}

const simpleRoots = (roots: PhraseTreeNode[]) => roots.filter((r) => r.section === SIMPLE_DESCRIPTION_SECTION);
export const simpleFacetIds = (roots: PhraseTreeNode[]) => {
  const collect = (n: PhraseTreeNode): string[] => [...n.facetValueIds ?? [], ...n.children.flatMap(collect)];
  return [...new Set(simpleRoots(roots).flatMap(collect))];
};

/** Значения ещё не отвеченного признака можно предложить. Известный признак отсекает чужие варианты. */
export function simpleChoiceForest(roots: PhraseTreeNode[], context: ProductCtx, parentByValue: Map<string, string>) {
  const answered = new Set([...context.facetValueIds].map((id) => parentByValue.get(id)).filter(Boolean));
  const facetValueIds = new Set(context.facetValueIds);
  for (const [id, parent] of parentByValue) if (!answered.has(parent)) facetValueIds.add(id);
  return forProduct(simpleRoots(roots), { ...context, facetValueIds });
}

export function selectSimpleDescription(roots: PhraseTreeNode[], choices?: Record<string, string>) {
  const applicable = simpleRoots(roots);
  const picked = applicable.filter((r) => choices?.[r.id]);
  if (picked.length) {
    const root = picked[0];
    const node = picked.length === 1 ? findIn(root, choices![root.id]) : null;
    return node && !node.children.length ? { root, leaf: node } : null;
  }
  const candidates = applicable.flatMap((root) => {
    const collect = (n: PhraseTreeNode, specificity = 0, isDefault = false): Array<{ root: PhraseTreeNode; leaf: PhraseTreeNode; rank: number }> => {
      const spec = Math.max(specificity, n.kindIds?.length ? 2 : n.facetValueIds?.length || n.groupIds?.length ? 1 : 0);
      const defaulted = isDefault || n.isDefault;
      return n.children.length
        ? n.children.flatMap((c) => collect(c, spec, defaulted))
        : [{ root, leaf: n, rank: spec * 2 + Number(defaulted) }];
    };
    return collect(root);
  });
  const best = Math.max(...candidates.map((c) => c.rank));
  const equallyApplicable = candidates.filter((c) => c.rank === best);
  return equallyApplicable.length === 1 ? equallyApplicable[0] : null;
}

export function renderSimplePhrase(text: string, ids: string[], parts: Map<string, PartRec>) {
  if (!text.includes('{parts}')) return text;
  const names = ids.map((id) => {
    const part = parts.get(id);
    return String(part?.genPlural || part?.genSingular || '').trim();
  });
  if (!names.length || names.some((n) => !n)) return '';
  return text.replaceAll('{parts}', joinRu([...new Set(names)]));
}

export interface ReadinessItem { key: string; label: string; hint: string }
export interface PassportReadiness {
  installationPlan?: InstallationPlan;
  ready: boolean;
  missing: ReadinessItem[];
  recommendations: ReadinessItem[];
  defaulted: Array<{ key: string; label: string }>;
  requiredImages: string[];
  imageSlots: string[];
}

export interface PassportPrintSources {
  installationPlan?: InstallationPlan;
  readiness: PassportReadiness;
  install: InstallKind;
  effectiveImages: Doc[];
  standardImages: Doc[];
  photoUrls?: Record<string, string>;
  supplier: { id: string; name: string; hasSeal: boolean; hasSignature: boolean } | null;
  org: PdfOrg | null;
  assets?: Record<string, string>;
  style?: PdfV2Style;
  look: LookDoc | null;
}
