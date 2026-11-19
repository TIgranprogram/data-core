import { api } from '../../core/api.js';

export const bookVariants = [
  { key: 'short', label: 'Упрощённый' },
  { key: 'full', label: 'Полный' },
];
export const variantName = (variant) => bookVariants.find((item) => item.key === variant)?.label;
export const simpleTextHref = (source) => '#dicts?d=passportPhrases'
  + (source?.kind === 'dictionary' && source.id ? '&of=ptnode&open=' + encodeURIComponent(source.id) : '');

const templatePath = (id) => `/showcase/${id}/passport-template`;

export function loadBookTemplate(id, variant = 'short') {
  return api(templatePath(id), { query: { variant } });
}

/** Сравниваем собственные настройки, сохраняя независимые изменения других редакторов. */
export function templatePatch(defaults, changes) {
  const expected = Object.fromEntries(Object.entries(changes).map(([key, value]) => [
    key, value && ['textChoices', 'textOverrides'].includes(key)
      ? Object.fromEntries(Object.keys(value).map((root) => [root, defaults[key]?.[root] ?? null]))
      : defaults[key] ?? null,
  ]));
  return { expected, changes };
}

export function saveBookTemplate(template, changes, baseline = template.defaults) {
  return api(templatePath(template.productId), {
    method: 'PATCH',
    query: { variant: template.variant },
    body: templatePatch(baseline, changes),
  });
}

export function templateDocument(template) {
  if (template.mode !== 'template' || !template.document || !template.readiness) {
    throw new Error('Сервер не вернул шаблон паспорта изделия.');
  }
  return {
    ...template.document,
    productId: template.productId,
    passportCategory: template.passportCategory,
    presentationVersion: 1,
    variant: template.variant,
    textSnapshot: template.textSnapshot,
    effectiveImages: template.effectiveImages,
    standardImages: template.standardImages,
    readiness: template.readiness,
    requiredImages: template.readiness.requiredImages,
    imageSlots: template.readiness.imageSlots,
  };
}
