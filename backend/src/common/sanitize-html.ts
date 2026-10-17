import DOMPurify, { type WindowLike } from 'dompurify';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
// TZ-MATERIALS-308 code-review fix / trustedTypes type blocker:
// dompurify v3.4 ожидает параметр `WindowLike` (= Pick<typeof globalThis, …>
// & … & Pick<TrustedTypesWindow, 'trustedTypes'>). JSDOM-окно не реализует
// Trusted Types, поэтому каст в `typeof globalThis` ломал tsc (trustedTypes
// обязателен в типе). Кастим в официальный экспортируемый тип библиотеки.
const purify = DOMPurify(window as unknown as WindowLike);

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3',
  'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'br', 'hr',
  'a', 'span',
];

const ALLOWED_ATTR = ['style', 'href', 'data-*'];

const CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
  ALLOW_DATA_ATTR: true,
  SAFE_FOR_TEMPLATES: true,
};

export function sanitizeHtml(raw: string): string {
  return purify.sanitize(raw, CONFIG) as string;
}

export function sanitizeBlockContent(raw: string): string {
  return sanitizeHtml(`<div>${raw}</div>`);
}
