import { JSDOM } from 'jsdom';
import { sanitizeHtml } from '../../common/sanitize-html';

const TOKEN_RE = /\{\{\s*[\w.]+\s*\}\}/g;
const MARKER_PREFIX = 'KPPDF_TOKEN_';

/**
 * TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — sanitize a block's TipTap HTML on save.
 *
 * Goals (block.style is the single source of typography):
 *   1. strip inline `font-family`, `font-size`, `color` declarations → they
 *      must not compete with `block.style` in the DB;
 *   2. remove empty `<span>` leftovers;
 *   3. keep semantic markup: b/strong, i/em, u, a[href], br, p, lists, and
 *      substitution tokens `{{path.to.field}}`.
 *
 * Token protection: the shared DOMPurify config runs with
 * `SAFE_FOR_TEMPLATES: true`, which strips `{{…}}` text. Save-time sanitizing
 * would therefore eat data-binding tokens, breaking the renderer's
 * substitution (`document-render.service.ts`). So we temporarily replace
 * `{{…}}` with an inert marker, sanitize, then restore the original token.
 */
export function sanitizeBlockHtml(raw: string | null | undefined): string {
  const input = raw ?? '';
  const restored = new Map<string, string>();
  const protectedInput = input.replace(TOKEN_RE, (token) => {
    const marker = `${MARKER_PREFIX}${restored.size}`;
    restored.set(marker, token);
    return marker;
  });

  const sanitized = sanitizeHtml(protectedInput);

  const dom = new JSDOM(`<body>${sanitized}</body>`);
  const document = dom.window.document;
  const body = document?.body ?? document?.querySelector?.('body');
  if (!body) return sanitized;

  // Strip inline font-family / font-size / color (block.style owns typography).
  for (const element of Array.from(body.querySelectorAll<HTMLElement>('[style]'))) {
    const style = element.style;
    style.removeProperty('font-family');
    style.removeProperty('font-size');
    style.removeProperty('color');
    if (!style.cssText.trim()) element.removeAttribute('style');
  }

  // Drop empty <span>s left over after style removal (only when truly empty).
  for (const span of Array.from(body.querySelectorAll('span'))) {
    const hasAttr = Array.from(span.attributes).some(
      (a) => !(a.name === 'style' && a.value.trim() === ''),
    );
    if (!hasAttr && !span.textContent?.trim()) {
      span.replaceWith(...Array.from(span.childNodes));
    }
  }

  let out = body.innerHTML;
  // Restore tokens after DOMPurify + JSDOM round-trip.
  for (const [marker, token] of restored) {
    out = out.split(marker).join(token);
  }
  return out;
}