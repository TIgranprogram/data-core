import { compose, legacyStartNumber, legacyTemplateToBlocks, usedStandards, type ComposedSection, type LegacyTemplateLike, type PassportTextBlock, type StandardsDict } from './passport-compose';
import { describeProduct, installText, maintenanceTables, purposeText, usageRules, type DictRec, type InstallParts, type MaintenanceTable } from './passport-compose-parts';

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
}

const idOf = (r: DictRec) => String(r.id ?? r._id ?? '');
const pick = (list: DictRec[] = [], ids: unknown[] = []) => { const want = new Set(ids.map(String)); return list.filter((r) => want.has(idOf(r))); };

export function buildV2Text(input: V2TextInput): V2Text {
  const { passport: p, all, own, standards = {}, dicts = {} } = input;
  const category = String(p.passportCategory || '');
  const ownBlocks: PassportTextBlock[] = own ? legacyTemplateToBlocks(own).map((b) => ({ ...b, category })) : [];
  const blocks = [...legacyTemplateToBlocks(all), ...ownBlocks];
  const elements = pick(dicts.elements, p.elements as unknown[]);
  const materials = pick(dicts.materials, p.materialIds as unknown[]);
  const install = (dicts.install || []).find((r) => idOf(r) === String(p.installationTypeId ?? '')) ?? null;
  const r = compose(blocks, p, category, { standards, startNumber: legacyStartNumber(all) });
  return {
    templateVersion: all.version ?? 0,
    ownVersion: own?.version ?? null,
    category,
    description: describeProduct(p as never, elements, materials),
    purpose: purposeText(elements),
    rules: usageRules(elements),
    maintenance: maintenanceTables(materials, elements, dicts.defects || [], install),
    install: installText(install),
    sections: r.sections,
    missing: r.missing,
    standards: usedStandards(blocks),
  };
}
