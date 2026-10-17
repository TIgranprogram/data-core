// Use the REAL dompurify + jsdom — jest auto-substitutes passthrough mocks
// (src/common/__mocks__/) unless unmocked, which would hide the token-stripping
// behaviour of DOMPurify SAFE_FOR_TEMPLATES. See sanitize-html.spec.ts.
jest.unmock('dompurify');
jest.unmock('jsdom');

import { sanitizeBlockHtml } from './block-content-sanitizer';

/**
 * TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — sanitize rules:
 *  - strip inline font-family / font-size / color (block.style owns typography);
 *  - remove empty spans left over;
 *  - preserve b/strong, i/em, u, a[href], br, p, lists;
 *  - preserve substitution tokens {{path.to.field}}.
 */
describe('sanitizeBlockHtml (TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE)', () => {
  it('preserves substitution tokens {{…}} (DOMPurify SAFE_FOR_TEMPLATES would strip them)', () => {
    const html = sanitizeBlockHtml('<p>Сегодня {{order.number}} штук</p>');
    expect(html).toContain('{{order.number}}');
  });

  it('preserves a token mixed with bold and a link', () => {
    const html = sanitizeBlockHtml(
      '<p>Заказ <strong>{{order.number}}</strong> на <a href="https://example.test">сайте</a></p>',
    );
    expect(html).toContain('{{order.number}}');
    expect(html).toContain('<strong>');
    expect(html).toContain('<a href="https://example.test"');
  });

  it('preserves b/strong, i/em, u, br, p, lists', () => {
    const html = sanitizeBlockHtml(
      '<p><strong>Bold</strong> <em>Ital</em> <u>Under</u><br>end</p><ul><li>one</li></ul>',
    );
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>Ital</em>');
    expect(html).toContain('<u>Under</u>');
    expect(html).toContain('<br>');
    expect(html).toContain('<ul><li>one</li></ul>');
  });

  it('strips inline font-family / font-size / color declarations', () => {
    const html = sanitizeBlockHtml(
      '<p style="font-family: Arial; font-size: 22px; color: red">text</p>',
    );
    expect(html).not.toMatch(/font-family|font-size|color:/);
    expect(html).toContain('text');
  });

  it('removes empty spans left over after style stripping, keeps non-empty spans', () => {
    const html = sanitizeBlockHtml(
      '<p><span style="color: red"></span>keep<span>X</span></p>',
    );
    expect(html).not.toContain('color: red');
    expect(html).not.toMatch(/<span><\/span>/);
    expect(html).toContain('keep<span>X</span>');
  });

  it('removes script/iframe (DOMPurify hardening still active)', () => {
    const html = sanitizeBlockHtml('<p>ok</p><script>alert(1)</script><iframe></iframe>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
  });

  it('returns empty string for empty/null input', () => {
    expect(sanitizeBlockHtml(null)).toBe('');
    expect(sanitizeBlockHtml('')).toBe('');
  });
});