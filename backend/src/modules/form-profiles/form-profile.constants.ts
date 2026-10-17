/**
 * TZ-DICT-314 — FieldKey allowlist + LockedRequired + S/M/L seed defaults.
 * Canon: docs/audits/2026-08-09-quick-create-form-profiles.md §4
 *
 * Not an EAV schema: only known FieldKeys; FullEditor stays separate.
 */

export const FORM_PROFILE_ENTITIES = ['product', 'module'] as const;
export type FormProfileEntity = (typeof FORM_PROFILE_ENTITIES)[number];

export const FORM_PROFILE_SIZES = ['S', 'M', 'L'] as const;
export type FormProfileSize = (typeof FORM_PROFILE_SIZES)[number];

/** Product QuickCreate FieldKeys (P0). */
export const PRODUCT_FIELD_KEYS = [
  'name',
  'kind',
  'unit',
  'sku',
  'listPrice',
  'categoryId',
  'isActive',
  'status',
  'dimLength',
  'dimWidth',
  'dimHeight',
  'dimUnit',
  'weightKg',
  'description',
  'notes',
] as const;

/** Module QuickCreate FieldKeys (P0). */
export const MODULE_FIELD_KEYS = [
  'name',
  'article',
  'width',
  'height',
  'depth',
  'unit',
  'weight',
  'notes',
] as const;

export type ProductFieldKey = (typeof PRODUCT_FIELD_KEYS)[number];
export type ModuleFieldKey = (typeof MODULE_FIELD_KEYS)[number];
export type FormFieldKey = ProductFieldKey | ModuleFieldKey;

export const LOCKED_REQUIRED: Record<FormProfileEntity, readonly string[]> = {
  product: ['kind', 'unit', 'sku'],
  module: ['name', 'article'],
};

export const ALLOWED_FIELD_KEYS: Record<FormProfileEntity, readonly string[]> = {
  product: PRODUCT_FIELD_KEYS,
  module: MODULE_FIELD_KEYS,
};

/** Seed matrices from audit §4 (S ⊂ M ⊂ L). */
export const DEFAULT_VISIBLE: Record<
  FormProfileEntity,
  Record<FormProfileSize, readonly string[]>
> = {
  product: {
    S: ['name', 'kind', 'unit', 'sku'],
    M: ['name', 'kind', 'unit', 'sku', 'listPrice', 'categoryId', 'isActive'],
    L: [
      'name',
      'kind',
      'unit',
      'sku',
      'listPrice',
      'categoryId',
      'isActive',
      'status',
      'dimLength',
      'dimWidth',
      'dimHeight',
      'dimUnit',
      'weightKg',
      'description',
      'notes',
    ],
  },
  module: {
    S: ['name', 'article'],
    M: ['name', 'article', 'width', 'height', 'depth', 'unit', 'weight'],
    L: ['name', 'article', 'width', 'height', 'depth', 'unit', 'weight', 'notes'],
  },
};

export function isFormProfileEntity(value: string): value is FormProfileEntity {
  return (FORM_PROFILE_ENTITIES as readonly string[]).includes(value);
}

export function isFormProfileSize(value: string): value is FormProfileSize {
  return (FORM_PROFILE_SIZES as readonly string[]).includes(value);
}
