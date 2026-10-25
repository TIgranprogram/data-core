import { compose, legacyStartNumber, legacyTemplateToBlocks, usedStandards, type ComposedSection, type LegacyTemplateLike, type PassportTextBlock, type StandardsDict } from './passport-compose';
import { choicesObject, resolveChoices, FIELD_SECTIONS, type PhraseTreeNode } from '../../common/passport/phrase-tree';
import { describeProduct, installText, maintenanceTables, usageRules, type DictRec, type InstallParts, type MaintenanceTable } from './passport-compose-parts';

/**
 * Полный текст паспорта v2 (БЗ-6 Э4a3) — чистая функция: шаблон «Для всех» + версия категории (пункт категории с тем же
 * ключом заменяет пункт «Для всех») + части из справочников (описание, назначение, правила, ТО по периодам, монтаж).
 * Результат кладётся в паспорт как снимок `textSnapshot` — правка справочников и шаблонов выданный паспорт не меняет.
 */
export interface V2TextInput {
  passport: Record<string, unknown> & { passportCategory?: string; elements?: unknown[]; materialIds?: unknown[]; installationTypeId?: unknown };
  all: LegacyTemplateLike & { version?: number };
  own?: (LegacyTemplateLike & { version?: number }) | null;
  standards?: StandardsDict;
  dicts?: { elements?: DictRec[]; materials?: DictRec[]; defects?: DictRec[]; install?: DictRec[] };
  /** Воронка (ПВ): дерево текстов категории и выбор паспорта { rootId: leafId } — тексты по выбору идут верхним слоем. */
  funnel?: { forest: PhraseTreeNode[]; choices?: Record<string, unknown> | null };
}

export interface V2Text {
  templateVersion: number;
  ownVersion: number | null;
  category: string;
  description: string;
  purpose: string;
  rules: string[];
  maintenance: MaintenanceTable[];
  install: InstallParts;
  sections: ComposedSection[];
  missing: string[];
  standards: string[];
  /** Итоговый выбор по разделам воронки { rootId: leafId } (с подставленным самим единственным вариантом). */
  choices: Record<string, string>;
}

const idOf = (r: DictRec) => String(r.id ?? r._id ?? '');
const pick = (list: DictRec[] = [], ids: unknown[] = []) => { const want = new Set(ids.map(String)); return list.filter((r) => want.has(idOf(r))); };

/** Текст листа воронки с подстановкой {переменных}; недостающие — в missing. */
function fill(text: string, passport: V2TextInput['passport'], category: string, standards: StandardsDict, missing: Set<string>): string {
  const r = compose([{ sectionKey: 'x', key: 'p1', text }], passport, category, { standards });
  r.missing.forEach((m) => missing.add(m));
  return r.sections[0]?.items[0]?.text ?? '';
}

export function buildV2Text(input: V2TextInput): V2Text {
  const { passport: p, all, own, standards = {}, dicts = {} } = input;
  const category = String(p.passportCategory || '');
  const ownBlocks: PassportTextBlock[] = own ? legacyTemplateToBlocks(own).map((b) => ({ ...b, category })) : [];
  const blocks = [...legacyTemplateToBlocks(all), ...ownBlocks];
  // воронка: разделы «Назначение» и «Установка» идут в поля, остальные — заменяют пункт №slot раздела шаблона
  const resolved = resolveChoices(input.funnel?.forest ?? [], input.funnel?.choices);
  const extraMissing = new Set<string>();
  let purpose = '';
  let installLeaf: PhraseTreeNode | null = null;
  const used: Array<{ text: string; sectionTitle?: string }> = [];
  for (const root of input.funnel?.forest ?? []) {
    const leaf = resolved.leaves.get(root.id)?.leaf;
    if (!leaf) continue;
    used.push({ text: leaf.text });
    if (root.section === 'purpose') purpose = purpose || fill(leaf.text, p, category, standards, extraMissing);
    else if (root.section === 'installation') installLeaf = installLeaf ?? leaf;
    else if (!(FIELD_SECTIONS as readonly string[]).includes(root.section)) {
      const host = blocks.find((b) => b.sectionKey === root.section);
      blocks.push({ category, sectionKey: root.section, sectionTitle: host?.sectionTitle || root.name, sectionOrder: host?.sectionOrder, key: `p${root.slot}`, order: root.slot - 1, text: leaf.text });
    }
  }
  const elements = pick(dicts.elements, p.elements as unknown[]);
  const materials = pick(dicts.materials, p.materialIds as unknown[]);
  const install = (dicts.install || []).find((r) => idOf(r) === String(p.installationTypeId ?? '')) ?? null;
  const r = compose(blocks, p, category, { standards, startNumber: legacyStartNumber(all) });
  const installParts = installText(install);
  if (installLeaf) installParts.text = fill((installLeaf as PhraseTreeNode).text, p, category, standards, extraMissing);
  return {
    templateVersion: all.version ?? 0,
    ownVersion: own?.version ?? null,
    category,
    description: describeProduct(p as never, elements, materials),
    purpose,
    rules: usageRules(elements),
    maintenance: maintenanceTables(materials, elements, dicts.defects || [], install),
    install: installParts,
    sections: r.sections,
    missing: [...new Set([...r.missing, ...extraMissing])],
    standards: usedStandards([...blocks, ...used]),
    choices: choicesObject(resolved),
  };
}
