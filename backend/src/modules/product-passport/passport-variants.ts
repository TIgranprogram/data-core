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

export type InstallKind = 'concrete' | 'anchor' | 'unknown';

/** Способ установки из справочника `passportInstall` (по коду и названию): бетонирование / анкерное крепление. */
export function installKindOf(install: { code?: unknown; name?: unknown } | null | undefined): InstallKind {
  const s = `${install?.code ?? ''} ${install?.name ?? ''}`;
  if (/бетон|concret/i.test(s)) return 'concrete';
  if (/анкер|anchor/i.test(s)) return 'anchor';
  return 'unknown';
}

export interface VariantCtx { category?: string; install?: InstallKind; variant?: PassportVariant }

/** Печатается/требуется ли рисунок этого вида при данных условиях (поправка и к «обязательным», и к картинкам PDF). */
export function imageKindAllowed(kind: string, ctx: VariantCtx): boolean {
  if (SAFETY_KINDS.includes(kind) && ctx.category !== PLAYGROUND_CATEGORY) return false;
  if (kind === 'foundation' && ctx.install === 'anchor') return false;
  if (OPTIONAL_IMAGE_KINDS.includes(kind) && variantOf(ctx.variant) === 'short') return false;
  return true;
}

/** Схема фундамента нужна именно при бетонировании. */
export const foundationRequired = (ctx: VariantCtx) => ctx.install === 'concrete';

/** Убрать лишние рисунки (формат PDF: вид → картинки). */
export function filterImagesByKind<T>(byKind: Record<string, T[]>, ctx: VariantCtx): Record<string, T[]> {
  return Object.fromEntries(Object.entries(byKind).filter(([k]) => imageKindAllowed(k, ctx)));
}
