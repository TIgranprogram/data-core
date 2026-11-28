/**
 * Варианты паспорта и правила по категории/способу установки (решения пользователя 2026-11-01, docs/PASSPORTS-V2.md
 * «Варианты и правила по категориям»). Чистые функции без БД — их берут и проверка «не хватает», и печать PDF.
 */
export type PassportVariant = 'short' | 'full';
export const PASSPORT_VARIANTS: readonly PassportVariant[] = ['short', 'full'];

/** Неизвестное значение — упрощённый вариант (по умолчанию). */
export const variantOf = (v: unknown): PassportVariant => (v === 'full' ? 'full' : 'short');

/** Категория «детские игровые площадки» (ГОСТ Р 52301 / ТР ЕАЭС 042): только ей нужна «Зона безопасности». */
export const PLAYGROUND_CATEGORY = 'DIO';
/** Виды рисунка «зона безопасности» (safety — имя в форме v1, safety_zone — v2). */
const SAFETY_KINDS = ['safety', 'safety_zone'];

/**
 * НЕОБЯЗАТЕЛЬНЫЕ разделы — только в полном паспорте (если заполнены); в упрощённом их нет и их отсутствие не мешает выпуску.
 * «Зона размещения» (место под изделие) = поля площадки siteLength/siteWidth; рисунки — общий вид с подписями частей,
 * табличка и дополнительные виды. Меняя список, обновите docs/PASSPORTS-V2.md.
 */
export const OPTIONAL_FIELDS: readonly string[] = ['siteLength', 'siteWidth'];
export const OPTIONAL_IMAGE_KINDS: readonly string[] = ['overview_callouts', 'nameplate', 'view_front', 'view_side', 'view_top', 'view_3d'];

/** Журналы (хранение, неисправности) и рекламации — в обоих вариантах (решение 2026-11-01, меняет ПТ-2): отдельного списка «только полный» нет. */

/** Строка о сертификате/декларации; пустой номер — строки нет. Для детских площадок — со ссылкой на ТР ЕАЭС 042/2017 (ПТ-1). */
export function certificateLine(cert: { number?: unknown } | null | undefined, category?: string): string {
  const n = String(cert?.number ?? '').trim();
  if (!n) return '';
  return category === PLAYGROUND_CATEGORY ? `Сертификат/декларация соответствия ТР ЕАЭС 042/2017: ${n}` : `Сертификат/декларация: ${n}`;
}

export type InstallKind = 'concrete' | 'anchor' | 'bolted' | 'embedded' | 'surface' | 'freestanding' | 'laid' | 'fence' | 'unknown';
export interface InstallationPlan {
  code: string; known: boolean; kind: InstallKind; thirdImportKind: 'foundation' | 'mounting' | null;
  managedKinds: string[]; allowedKinds: string[]; requiredKinds: string[]; labels: Record<string, string>;
  depthApplicable: boolean; traits: string[];
}
/** C179: смысл задаёт стабильный код, а не название или ошибочные признаки справочника. */
export function installationProfile(install: { code?: unknown; requiredImages?: unknown } | null | undefined): InstallationPlan {
  const raw = String(install?.code ?? '').trim().toUpperCase();
  const code = ({ ANCHOR: 'ANCHORS', CONCRETE: 'CONCRETE_POSTS' } as Record<string, string>)[raw] ?? raw;
  const managedKinds = ['foundation', 'holes', 'embedded_layout', 'mounting'];
  const labels = { foundation: 'Схема фундамента', holes: 'Разметка ям под опоры', embedded_layout: 'Схема закладных деталей', mounting: 'Схема установки' };
  const configured = String(install?.requiredImages ?? '').split(/[\s,;]+/);
  const profiles: Record<string, [InstallKind, string[], string[], boolean, string[], 'foundation' | 'mounting']> = {
    ANCHORS: ['anchor', ['mounting'], ['mounting'], false, ['anchors'], 'mounting'],
    BOLTED: ['bolted', ['mounting'], ['mounting'], false, ['bolts'], 'mounting'],
    CONCRETE_POSTS: ['concrete', ['foundation', 'holes'], ['foundation', ...(configured.includes('holes') ? ['holes'] : [])], true, ['concrete'], 'foundation'],
    EMBEDDED: ['embedded', ['foundation', 'embedded_layout'], ['foundation', ...(configured.includes('embedded_layout') ? ['embedded_layout'] : [])], false, [], 'foundation'],
    ON_SURFACE: ['surface', ['mounting'], [], false, [], 'mounting'],
    FREESTANDING: ['freestanding', ['mounting'], [], false, ['freestanding'], 'mounting'],
    LAID: ['laid', ['mounting'], [], false, ['freestanding'], 'mounting'],
    FENCE_POSTS: ['fence', ['foundation', 'holes'], configured.filter(k => ['foundation', 'holes'].includes(k)), true, ['concrete'], 'foundation'],
  };
  const row = profiles[code];
  if (code === 'ANCHORS') labels.mounting = 'Схема анкерного крепления';
  if (code === 'BOLTED') labels.mounting = 'Схема болтового соединения';
  return { code, known: !!row, kind: row?.[0] ?? 'unknown', managedKinds, allowedKinds: row?.[1] ?? [], requiredKinds: row?.[2] ?? [], labels, depthApplicable: row?.[3] ?? false, traits: row?.[4] ?? [], thirdImportKind: row?.[5] ?? null };
}
export const installKindOf = (install: { code?: unknown; name?: unknown } | null | undefined): InstallKind => installationProfile(install).kind;
export interface VariantCtx { category?: string; install?: InstallKind; variant?: PassportVariant; installationPlan?: InstallationPlan }
const codeOfKind: Record<InstallKind, string> = { concrete: 'CONCRETE_POSTS', anchor: 'ANCHORS', bolted: 'BOLTED', embedded: 'EMBEDDED', surface: 'ON_SURFACE', freestanding: 'FREESTANDING', laid: 'LAID', fence: 'FENCE_POSTS', unknown: '' };
export const planOfContext = (ctx: VariantCtx): InstallationPlan => ctx.installationPlan ?? installationProfile({ code: codeOfKind[ctx.install ?? 'unknown'] });
export function imageKindAllowed(kind: string, ctx: VariantCtx): boolean {
  if (SAFETY_KINDS.includes(kind) && ctx.category !== PLAYGROUND_CATEGORY) return false;
  const plan = planOfContext(ctx);
  if (plan.managedKinds.includes(kind) && !plan.allowedKinds.includes(kind)) return false;
  if (OPTIONAL_IMAGE_KINDS.includes(kind) && variantOf(ctx.variant) === 'short') return false;
  return true;
}
export const foundationRequired = (ctx: VariantCtx) => planOfContext(ctx).requiredKinds.includes('foundation');

/** Убрать лишние рисунки (формат PDF: вид → картинки). */
export function filterImagesByKind<T>(byKind: Record<string, T[]>, ctx: VariantCtx): Record<string, T[]> {
  return Object.fromEntries(Object.entries(byKind).filter(([k]) => imageKindAllowed(k, ctx)));
}

/** Новая редакция рисунков сохраняет немонтажные условия старого снимка, монтаж согласует целиком. */
export function reconcileInstallationRules(prior: { requiredImages: string[]; imageSlots: string[] }, plan: InstallationPlan): { required: string[]; slots: string[] } {
  const unmanaged = (kind: string) => !plan.managedKinds.includes(kind);
  return {
    required: [...new Set([...prior.requiredImages.filter(unmanaged), ...plan.requiredKinds])],
    slots: [...new Set([...prior.imageSlots.filter(unmanaged), ...plan.allowedKinds])],
  };
}
