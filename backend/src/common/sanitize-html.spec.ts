// Используем РЕАЛЬНЫЕ dompurify + jsdom (не passthrough-моки из
// src/common/__mocks__/, которые подставляются автоматически в unit-jest) —
// иначе тесты «пропускали» бы <script> и не проверяли бы санитизацию.
// jest.unmock hoist'ится ts-jest над импортами.
jest.unmock('dompurify');
jest.unmock('jsdom');

import { sanitizeHtml, sanitizeBlockContent } from './sanitize-html';

/**
 * TZ-105.3 / sanitizer unit spec.
 *
 * Проверяет, что DOMPurify-конфиг (ALLOWED_TAGS/ALLOWED_ATTR/FORBID_*) реально
 * работает в node-окружении (jsdom window) и не ослаблен:
 *  - безопасный HTML сохраняется;
 *  - script / iframe / object / embed удаляются;
 *  - javascript:-URL вырезаются;
 *  - inline event handlers (on* атрибуты) удаляются;
 *  - sanitizeBlockContent() оборачивает контент в <div> и санитизирует.
 *
 * Используются реальные jsdom + dompurify (без e2e-mock'ов) — это guard против
 * регрессии типа TrustedTypes и против случайного ослабления sanitization.
 */
describe('sanitize-html (TZ-105.3)', () => {
  it('preserves safe HTML', () => {
    const out = sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(out).toContain('<p>Hello');
    expect(out).toContain('<strong>world</strong>');
  });

  it('removes <script> tags and their content', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('removes <iframe> tags', () => {
    const out = sanitizeHtml('<p>ok</p><iframe src="https://evil.example"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('strips javascript: URLs from href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('strips inline event handlers (onclick)', () => {
    const out = sanitizeHtml('<a href="#" onclick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
  });

  it('strips inline event handlers (onerror/onload/onmouseover)', () => {
    const out = sanitizeHtml(
      '<span onerror="steal()" onload="x()" onmouseover="y()">t</span>',
    );
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('onmouseover');
  });

  it('rejects object/embed as well', () => {
    const out = sanitizeHtml(
      '<p>ok</p><object data="x.swf"></object><embed src="y.swf">',
    );
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<embed');
  });

  it('sanitizeBlockContent wraps content for parsing, then strips the wrapper and sanitizes inside', () => {
    const out = sanitizeBlockContent('<p>ok</p><script>evil()</script>');
    // <div> не входит в ALLOWED_TAGS — обёртка нужна только для корректного
    // парсинга и удаляется санитайзером (как и <script> с содержимым).
    expect(out).not.toContain('<div');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('evil()');
    expect(out).toContain('<p>ok</p>');
  });
});
