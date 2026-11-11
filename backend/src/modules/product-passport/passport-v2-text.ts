import { compose, legacyStartNumber, legacyTemplateToBlocks, usedStandards, TRAITS_FIELD, type ComposedSection, type ExcludedItem, type LegacyTemplateLike, type PassportTextBlock, type StandardsDict } from './passport-compose';
import { collectTraits, filterByWhen } from './passport-traits';
import { overrideFor } from '../../common/passport/text-overrides';
import { choicesObject, resolveChoices, FIELD_SECTIONS, type PhraseTreeNode, type ProductCtx } from '../../common/passport/phrase-tree';
import { describeProduct, installText, maintenanceTables, usageRules, type DictRec, type InstallParts, type MaintenanceTable } from './passport-compose-parts';

/**
 * Полный текст паспорта v2 (БЗ-6 Э4a3) — чистая функция: шаблон «Для всех» + версия категории (пункт категории с тем же
 * ключом заменяет пункт «Для всех») + части из справочников (описание, назначение, правила, ТО по периодам, монтаж).
 * Результат кладётся в паспорт как снимок `textSnapshot` — правка справочников и шаблонов выданный паспорт не меняет.
 */
export interface V2TextInput {
  /** Внутренний сбор полей фактически выбранных текстов независимо от заполненности. */
  usedFields?: Set<string>;
  passport: Record<string, unknown> & { passportCategory?: string; elements?: unknown[]; materialIds?: unknown[]; installationTypeId?: unknown };
  all: LegacyTemplateLike & { version?: number };
  own?: (LegacyTemplateLike & { version?: number }) | null;
  standards?: StandardsDict;
  dicts?: { elements?: DictRec[]; materials?: DictRec[]; defects?: DictRec[]; install?: DictRec[] };
  /** Воронка (ПВ): дерево текстов категории и выбор паспорта { rootId: leafId } — тексты по выбору идут верхним слоем. */
  funnel?: { forest: PhraseTreeNode[]; choices?: Record<string, unknown> | null; product?: ProductCtx };
}

/** Текст раздела воронки, как он входит в паспорт этого изделия (C060): таблица «Тексты этого изделия» в шаблоне. */
export interface FunnelText {
  id: string; section: string; name: string; variant: string;
  /** Текст с подставленными значениями; у убранного раздела — текст варианта, которого в паспорте не будет. */
  text: string;
  /** Свой текст изделия вместо варианта справочника. */
  own: boolean;
  /** Раздел убран из паспорта этого изделия. */
  off: boolean;
  /** Раздел можно убрать (назначение и установка идут в поля паспорта — их только заменяют). */
  canOff: boolean;
  /** Текст варианта справочника (когда задан свой) — для «Вернуть». */
  original?: string;
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
  /** C060: тексты разделов воронки этого изделия (с учётом своих правок) — для таблицы в шаблоне. */
  funnel: FunnelText[];
  /** Итоговый выбор по разделам воронки { rootId: leafId } (с подставленным самим единственным вариантом). */
  choices: Record<string, string>;
  /** Признаки изделия, по которым считались условия when (справочники + «Конструкция»), и откуда каждый. */
  traits: string[];
  traitsFrom: Record<string, string[]>;
  /** Признаки без ответа (соединения не выбраны): условия на них не считаются «нет». */
  unknownTraits: string[];
  /** Что не вошло из-за when (пункты текста и дефекты); unknown — ждёт выбора «Конструкция». PDF печатается из снимка, when при печати не считается. */
  excluded: ExcludedItem[];
  /** Есть условные пункты на bolts / welds, а соединения не выбраны — выпуск ждёт выбора. */
  needJoints: boolean;
  /** Версия раскладки PDF: 2 — нумерация в один проход, один раздел «Монтаж». Нет поля — как печаталось раньше. */
  layout: number;
}

const idOf = (r: DictRec) => String(r.id ?? r._id ?? '');
const pick = (list: DictRec[] = [], ids: unknown[] = []) => { const want = new Set(ids.map(String)); return list.filter((r) => want.has(idOf(r))); };

/** Текст листа воронки с подстановкой {переменных}; недостающие — в missing. */
function fill(text: string, passport: V2TextInput['passport'], category: string, standards: StandardsDict, missing: Set<string>, usedFields?: Set<string>): string {
  const r = compose([{ sectionKey: 'x', key: 'p1', text }], passport, category, { standards, usedFields });
  r.missing.forEach((m) => missing.add(m));
  return r.sections[0]?.items[0]?.text ?? '';
}

export function buildV2Text(input: V2TextInput): V2Text {
  const { passport: p, all, own, standards = {}, dicts = {} } = input;
  const category = String(p.passportCategory || '');
  const ownBlocks: PassportTextBlock[] = own ? legacyTemplateToBlocks(own).map((b) => ({ ...b, category })) : [];
  const blocks = [...legacyTemplateToBlocks(all), ...ownBlocks];
  // воронка: разделы «Назначение» и «Установка» идут в поля, остальные — заменяют пункт №slot раздела шаблона
  const resolved = resolveChoices(input.funnel?.forest ?? [], input.funnel?.choices, input.funnel?.product);
  const extraMissing = new Set<string>();
  let purpose = '';
  let installLeaf: PhraseTreeNode | null = null;
  const used: Array<{ text: string; sectionTitle?: string }> = [];
  const funnelTexts: FunnelText[] = [];
  for (const root of input.funnel?.forest ?? []) {
    const leaf = resolved.leaves.get(root.id)?.leaf;
    if (!leaf) continue;
    // C060: свой текст изделия вместо варианта справочника / раздел убран
    const ov = overrideFor(p.textOverrides, root.id, root.section);
    const text = ov.text ?? leaf.text;
    const sink = new Set<string>();
    funnelTexts.push({ id: root.id, section: root.section, name: root.name, variant: leaf.name, text: fill(text, p, category, standards, sink), own: !!ov.text, off: !!ov.off, canOff: !(FIELD_SECTIONS as readonly string[]).includes(root.section), ...(ov.text ? { original: fill(leaf.text, p, category, standards, sink) } : {}) });
    if (ov.off) continue;
    used.push({ text });
    if (root.section === 'purpose') purpose = purpose || fill(text, p, category, standards, extraMissing, input.usedFields);
    else if (root.section === 'installation') installLeaf = installLeaf ?? { ...leaf, text };
    else if (!(FIELD_SECTIONS as readonly string[]).includes(root.section)) {
      const host = blocks.find((b) => b.sectionKey === root.section);
      blocks.push({ category, sectionKey: root.section, sectionTitle: host?.sectionTitle || root.name, sectionOrder: host?.sectionOrder, key: `p${root.slot}`, order: root.slot - 1, text });
    }
  }
  const elements = pick(dicts.elements, p.elements as unknown[]);
  const materials = pick(dicts.materials, p.materialIds as unknown[]);
  const install = (dicts.install || []).find((r) => idOf(r) === String(p.installationTypeId ?? '')) ?? null;
  // признаки изделия: справочники + «Конструкция»; условия when пунктов и дефектов смотрят на них
  const info = collectTraits(p.joints, { elements, materials, install });
  const pt = { ...p, [TRAITS_FIELD]: info.traits };
  const r = compose(blocks, pt, category, { standards, startNumber: legacyStartNumber(all), unknownTraits: info.unknown, usedFields: input.usedFields });
  const installParts = installText(install);
  if (installLeaf) installParts.text = fill((installLeaf as PhraseTreeNode).text, p, category, standards, extraMissing, input.usedFields);
  // Вписанный вручную текст («свой текст», manualText) важнее справочника; назначение без выбора — из поля паспорта
  const manual = Array.isArray(p.manualText) ? (p.manualText as string[]) : [];
  const ownText = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim() : '');
  if (manual.includes('installationMethod') && ownText('installationMethod')) installParts.text = ownText('installationMethod');
  if (manual.includes('purpose') && ownText('purpose')) purpose = ownText('purpose');
  if (!purpose) purpose = ownText('purpose');
  const excluded: ExcludedItem[] = [...r.excluded];
  const exDefects = Array.isArray(p.excludeDefects) ? (p.excludeDefects as string[]) : [];
  const byCode = (dicts.defects || []).filter((d) => !exDefects.includes(String(d?.code ?? '')));
  const defects = filterByWhen(byCode, info, 'maintenance', excluded);
  const description = manual.includes('description') && ownText('description') ? ownText('description') : describeProduct(p as never, elements, materials, dicts.materials ?? []);
  return {
    templateVersion: all.version ?? 0,
    ownVersion: own?.version ?? null,
    category,
    description,
    purpose,
    rules: usageRules(elements),
    // excludeDefects: коды дефектов, которых нет у этого изделия (например, решётка без болтов и сварки — LOOSE_THREADS, WELD_CRACK)
    maintenance: maintenanceTables(materials, elements, defects.kept, install),
    install: installParts,
    sections: r.sections,
    missing: [...new Set([...r.missing, ...extraMissing])],
    standards: usedStandards([...blocks, ...used]),
    funnel: funnelTexts,
    choices: choicesObject(resolved),
    traits: info.traits,
    traitsFrom: info.from,
    unknownTraits: info.unknown,
    excluded,
    needJoints: r.needJoints || defects.needJoints,
    layout: 2,
  };
}
