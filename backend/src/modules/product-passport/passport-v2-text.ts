import { exerciseInstructions, type ExerciseSnapshot } from '../../common/passport/exercise-instructions';
import { compose, legacyStartNumber, legacyTemplateToBlocks, usedStandards, TRAITS_FIELD, type ComposedSection, type ExcludedItem, type LegacyTemplateLike, type PassportTextBlock, type StandardsDict, type TextSrc } from './passport-compose';
import { collectTraits, filterByWhen } from './passport-traits';
import { overrideFor } from '../../common/passport/text-overrides';
import { choicesObject, resolveChoices, FIELD_SECTIONS, type PhraseTreeNode, type ProductCtx } from '../../common/passport/phrase-tree';
import { isBriefPresentation, printPhraseRoots, shortDetailSections } from './passport-presentation';
import { describeProduct, installText, maintenanceTables, usageRulesFrom, type DictRec, type InstallParts, type MaintenanceRow, type MaintenanceTable } from './passport-compose-parts';
import type { FieldRef, FieldRefs } from './passport-snapshot-field';
import { boltedTextBlock } from './passport-bolted-text';
import { installationProfile } from './passport-variants';

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
  exerciseInstructions?: ExerciseSnapshot;
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
  /** C130: откуда взяты части текста вне разделов (пункты разделов несут src сами) — для цвета в карточке. */
  src: { description: TextSrc; purpose: TextSrc; install: TextSrc };
  /** C132: откуда взята каждая строка (запись справочника / изделие / раздел воронки) — куда вести «Сохранить в справочнике». */
  refs: FieldRefs;
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
  const ownBlocks: PassportTextBlock[] = own ? legacyTemplateToBlocks(own).map((b) => ({ ...b, category, src: 'type' as TextSrc })) : [];
  const install = (dicts.install || []).find((r) => idOf(r) === String(p.installationTypeId ?? '')) ?? null;
  const bolted = installationProfile(install).kind === 'bolted';
  const templateBlocks = [...legacyTemplateToBlocks(all).map((b) => ({ ...b, src: 'all' as TextSrc })), ...ownBlocks];
  const blocks = bolted ? templateBlocks.map(boltedTextBlock) : templateBlocks;
  let purposeSrc: TextSrc = 'product'; let installSrc: TextSrc = 'product';
  const productId = p.productId ? String(p.productId) : '';
  const ofProduct = (field: string): FieldRef | null => (productId ? { kind: 'product', id: productId, field } : null);
  let purposeRef = ofProduct('purpose');
  let installRef: FieldRef | null = null;
  // воронка: разделы «Назначение» и «Установка» идут в поля, остальные — заменяют пункт №slot раздела шаблона
  const brief = isBriefPresentation(p);
  const forest = printPhraseRoots(input.funnel?.forest ?? [], brief);
  const resolved = resolveChoices(forest, input.funnel?.choices, input.funnel?.product);
  const extraMissing = new Set<string>();
  let purpose = '';
  let installLeaf: PhraseTreeNode | null = null;
  const used: Array<{ text: string; sectionTitle?: string }> = [];
  const funnelTexts: FunnelText[] = [];
  for (const root of forest) {
    const leaf = resolved.leaves.get(root.id)?.leaf;
    if (!leaf) continue;
    // C060: свой текст изделия вместо варианта справочника / раздел убран
    const ov = overrideFor(p.textOverrides, root.id, root.section);
    if (bolted && ['installation', 'mounting'].includes(root.section) && !ov.text && leaf.installTypeId !== String(p.installationTypeId)) {
      resolved.leaves.delete(root.id);
      continue;
    }
    const text = ov.text ?? leaf.text;
    const sink = new Set<string>();
    funnelTexts.push({ id: root.id, section: root.section, name: root.name, variant: leaf.name, text: fill(text, p, category, standards, sink), own: !!ov.text, off: !!ov.off, canOff: !(FIELD_SECTIONS as readonly string[]).includes(root.section), ...(ov.text ? { original: fill(leaf.text, p, category, standards, sink) } : {}) });
    if (ov.off) continue;
    used.push({ text });
    const src: TextSrc = ov.text ? 'manual' : 'product';
    if (root.section === 'purpose') { if (!purpose) { purpose = fill(text, p, category, standards, extraMissing, input.usedFields); purposeSrc = src; purposeRef = { kind: 'funnel', id: root.id, field: 'text' }; } }
    else if (root.section === 'installation') { if (!installLeaf) { installLeaf = { ...leaf, text }; installSrc = src; installRef = { kind: 'funnel', id: root.id, field: 'text' }; } }
    else if (!(FIELD_SECTIONS as readonly string[]).includes(root.section)) {
      const host = blocks.find((b) => b.sectionKey === root.section);
      blocks.push({ category, sectionKey: root.section, sectionTitle: host?.sectionTitle || root.name, sectionOrder: host?.sectionOrder, key: `p${root.slot}`, order: root.slot - 1, text, src });
    }
  }
  const elements = pick(dicts.elements, p.elements as unknown[]);
  const materials = pick(dicts.materials, p.materialIds as unknown[]);
  // признаки изделия: справочники + «Конструкция»; условия when пунктов и дефектов смотрят на них
  const info = collectTraits(p.joints, { elements, materials, install }, category);
  const pt = { ...p, [TRAITS_FIELD]: info.traits };
  const printedBlocks = brief ? blocks.filter((b) => !shortDetailSections.includes(b.sectionKey)) : blocks;
  const r = compose(printedBlocks, pt, category, { standards, startNumber: legacyStartNumber(all), unknownTraits: info.unknown, usedFields: input.usedFields });
  const installParts = installText(install, p.foundationSupportCount);
  if (installLeaf) installParts.text = fill((installLeaf as PhraseTreeNode).text, p, category, standards, extraMissing, input.usedFields);
  // Вписанный вручную текст («свой текст», manualText) важнее справочника; назначение без выбора — из поля паспорта
  const manual = Array.isArray(p.manualText) ? (p.manualText as string[]) : [];
  const ownText = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim() : '');
  if (manual.includes('installationMethod') && ownText('installationMethod')) { installParts.text = ownText('installationMethod'); installSrc = 'manual'; installRef = ofProduct('installation'); }
  if (manual.includes('purpose') && ownText('purpose')) { purpose = ownText('purpose'); purposeSrc = 'manual'; purposeRef = ofProduct('purpose'); }
  // монтаж не из воронки и не вписан вручную: способ установки из справочника (его запись и хранит текст), иначе — изделие
  if (!installRef) installRef = install && installParts.text ? { kind: 'install', id: idOf(install), field: install.montage != null ? 'montage' : 'mountText' } : ofProduct('installation');
  if (!purpose) purpose = ownText('purpose');
  const excluded: ExcludedItem[] = [...r.excluded];
  const exDefects = Array.isArray(p.excludeDefects) ? (p.excludeDefects as string[]) : [];
  const byCode = (dicts.defects || []).filter((d) => !exDefects.includes(String(d?.code ?? '')));
  const defects = filterByWhen(byCode, info, 'maintenance', excluded);
  const manualDescr = manual.includes('description') && !!ownText('description');
  const description = brief
    ? String((p.simpleDescription as { text?: unknown } | undefined)?.text ?? '').trim()
    : manualDescr ? ownText('description') : describeProduct(p as never, elements, materials, dicts.materials ?? []);
  const rules = usageRulesFrom(elements);
  const rowRefs = new Map<MaintenanceRow, FieldRef>();
  const maintenance = maintenanceTables(materials, elements, defects.kept, install, rowRefs);
  return {
    ...(p.exerciseInstructions ? { exerciseInstructions: { ...exerciseInstructions(p.exerciseInstructions), source: { kind: 'product' as const, productId } } } : {}),
    templateVersion: all.version ?? 0,
    ownVersion: own?.version ?? null,
    category,
    description,
    purpose,
    rules: rules.map((r) => r.text),
    // excludeDefects: коды дефектов, которых нет у этого изделия (например, решётка без болтов и сварки — LOOSE_THREADS, WELD_CRACK)
    maintenance,
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
    src: { description: manualDescr ? 'manual' : 'product', purpose: purposeSrc, install: installSrc },
    refs: { description: ofProduct('description'), purpose: purposeRef, install: installRef, rules: rules.map((r) => r.ref), maintenance: maintenance.flatMap((t) => t.rows.map((r) => rowRefs.get(r) ?? null)) },
    layout: 2,
  };
}

/**
 * C130: снимок, собранный до появления источников, — подписать их по свежей сборке (в базу не пишется, текст снимка не меняется).
 * Пункт ищется по коду раздела и пункта; нет такого пункта в свежей сборке — остаётся без источника.
 */
export function withTextSources<T extends { sections?: Array<{ key: string; items: Array<{ key: string; src?: TextSrc }> }>; src?: V2Text['src']; refs?: FieldRefs; rules?: string[]; maintenance?: Array<{ rows: unknown[] }> }>(snapshot: T, fresh: Pick<V2Text, 'sections' | 'src'> & { refs?: FieldRefs }): T {
  if (snapshot.src && snapshot.refs) return snapshot;
  // Старый снимок не доказывает идентичность источника даже при совпадении текста.
  const refs: FieldRefs = snapshot.refs ?? {};
  if (snapshot.src) return { ...snapshot, ...(refs ? { refs } : {}) };
  const by = new Map(fresh.sections.flatMap((s) => s.items.map((i) => [`${s.key}|${i.key}`, i.src] as const)));
  return {
    ...snapshot,
    ...(refs ? { refs } : {}),
    src: fresh.src,
    sections: (snapshot.sections ?? []).map((s) => ({ ...s, items: s.items.map((i) => { const src = i.src ?? by.get(`${s.key}|${i.key}`); return src ? { ...i, src } : i; }) })),
  };
}
