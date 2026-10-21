import { access, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Strip TipTap tags inside `{{…}}` tokens (legacy templates). TZ-KP-BIND-513 */
export function normalizeSubstitutionHtml(html: string): string {
  if (!html) return '';
  return html.replace(/\{\{[\s\S]*?\}\}/g, (token) =>
    token.replace(/<[^>]+>/g, ''),
  );
}

export function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Public origin for document `<base href>` (uploads in PDF / srcdoc). */
export function documentPublicOrigin(): string {
  const configured =
    process.env.KPPDF_PUBLIC_ORIGIN ??
    process.env.PUBLIC_BASE_URL ??
    'http://127.0.0.1:3000';
  try {
    return new URL(configured).origin;
  } catch {
    return 'http://127.0.0.1:3000';
  }
}

/**
 * TZ-NX-DOCSTUDIO-TABLE-PHOTO-BROKEN-IMG — single source of truth for the
 * uploads root, mirroring `photos/image-upload.options.ts`'s
 * `UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'` (multer's write
 * path). Every reader of `/uploads/*` files (this PDF inliner, the studio
 * table's file-existence check) must resolve the same directory multer
 * wrote to — a previous hardcoded `join(process.cwd(), 'uploads')` here and
 * in `studio-data-resolver.ts` only coincided with the write path when
 * `UPLOAD_DIR` was unset.
 */
export function resolveUploadsRoot(): string {
  return resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));
}

const SAFE_UPLOAD_URL_RE = /^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

/**
 * TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG — public single source of truth
 * for "does this `/uploads/*` URL still exist on disk", extracted from what
 * was a private `StudioDataResolverService.localUploadFileExists` (added by
 * TABLE-PHOTO-SMOKE, refined by TABLE-PHOTO-BROKEN-IMG to use
 * `resolveUploadsRoot()`) so catalog list endpoints (product/material
 * `findAll`) can apply the same orphan-reference check instead of a third
 * copy-pasted implementation.
 */
export async function localUploadFileExists(url: string): Promise<boolean> {
  if (!url.startsWith('/uploads/') || url.includes('..')) return false;
  const uploadsRoot = resolveUploadsRoot();
  const filePath = resolve(uploadsRoot, url.slice('/uploads/'.length));
  if (relative(uploadsRoot, filePath).startsWith('..')) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG — a populated `Photo` sub-document
 * can outlive its on-disk file (doc restored/copied without `uploads/`, file
 * manually removed). Blanks `storageUrl` in place on any doc whose file is
 * missing, so a stale reference degrades to the same empty-media placeholder
 * as a genuinely absent photo instead of a browser broken-image icon —
 * mirrors `StudioDataResolverService.resolveCatalogPhotoUrls`'s per-request
 * dedup (checking each unique URL once regardless of how many items share
 * the same photo).
 */
export async function blankMissingUploadUrls(
  docs: ReadonlyArray<{ storageUrl?: unknown } | null | undefined>,
): Promise<void> {
  const urls = [
    ...new Set(
      docs
        .map((doc) => (doc && typeof doc.storageUrl === 'string' ? doc.storageUrl : ''))
        .filter((url): url is string => url.length > 0),
    ),
  ];
  if (urls.length === 0) return;
  const existsByUrl = new Map<string, boolean>(
    await Promise.all(urls.map(async (url) => [url, await localUploadFileExists(url)] as const)),
  );
  for (const doc of docs) {
    if (doc && typeof doc.storageUrl === 'string' && doc.storageUrl && !existsByUrl.get(doc.storageUrl)) {
      (doc as { storageUrl?: string }).storageUrl = '';
    }
  }
}

const UPLOAD_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Collect `/uploads/...` paths from img src and CSS url() for PDF inlining. */
export function collectLocalUploadUrls(html: string): string[] {
  const urls = new Set<string>();
  const srcRe = /src\s*=\s*["'](\/uploads\/[^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = srcRe.exec(html)) !== null) {
    urls.add(match[1]);
  }
  const urlRe = /url\(\s*["']?(\/uploads\/[^"')]+)["']?\s*\)/gi;
  while ((match = urlRe.exec(html)) !== null) {
    urls.add(match[1]);
  }
  return [...urls];
}

/**
 * Inline local `/uploads/*` files as data URLs so Puppeteer PDF render does not
 * depend on HTTP reachability of KPPDF_PUBLIC_ORIGIN.
 */
export async function inlineLocalUploadsForPdf(html: string): Promise<string> {
  const urls = collectLocalUploadUrls(html);
  if (urls.length === 0) return html;

  const uploadsRoot = resolveUploadsRoot();
  const replacements = new Map<string, string>();

  await Promise.all(
    urls.map(async (url) => {
      if (!SAFE_UPLOAD_URL_RE.test(url) || url.includes('..')) return;
      const ext = url.split('.').pop()?.toLowerCase() ?? '';
      const mime = UPLOAD_EXT_MIME[ext];
      if (!mime) return;

      const rel = url.slice('/uploads/'.length);
      const filePath = resolve(uploadsRoot, rel);
      const relCheck = relative(uploadsRoot, filePath);
      if (relCheck.startsWith('..')) return;

      try {
        const buffer = await readFile(filePath);
        replacements.set(url, `data:${mime};base64,${buffer.toString('base64')}`);
      } catch {
        // Keep the original URL when the file is missing.
      }
    }),
  );

  if (replacements.size === 0) return html;

  let result = html;
  for (const [url, dataUrl] of replacements) {
    result = result.split(url).join(dataUrl);
  }
  return result;
}
