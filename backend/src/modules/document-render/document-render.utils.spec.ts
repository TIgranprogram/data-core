import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  blankMissingUploadUrls,
  collectLocalUploadUrls,
  inlineLocalUploadsForPdf,
  localUploadFileExists,
} from './document-render.utils';

describe('document-render.utils PDF upload inlining', () => {
  const uploadsDir = join(process.cwd(), 'uploads', 'pdf-inline-test');
  const publicUrl = '/uploads/pdf-inline-test/sample.png';

  beforeAll(async () => {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'sample.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(join(process.cwd(), 'uploads', 'pdf-inline-test'), {
      recursive: true,
      force: true,
    });
  });

  it('collects upload URLs from img src and CSS url()', () => {
    const html =
      '<img src="/uploads/pdf-inline-test/sample.png"><div style="background:url(/uploads/pdf-inline-test/sample.png)"></div>';
    expect(collectLocalUploadUrls(html)).toEqual([
      '/uploads/pdf-inline-test/sample.png',
    ]);
  });

  it('inlines local upload files as data URLs for PDF', async () => {
    const html = `<img src="${publicUrl}" alt="">`;
    const inlined = await inlineLocalUploadsForPdf(html);
    expect(inlined).toContain('data:image/png;base64,');
    expect(inlined).not.toContain(publicUrl);
  });

  it('leaves unknown upload paths unchanged when file is missing', async () => {
    const missing = '/uploads/pdf-inline-test/missing.webp';
    const html = `<img src="${missing}" alt="">`;
    const inlined = await inlineLocalUploadsForPdf(html);
    expect(inlined).toBe(html);
  });
});

describe('TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG — localUploadFileExists / blankMissingUploadUrls', () => {
  const uploadsDir = join(process.cwd(), 'uploads', 'vitrina-exists-test');
  const existingUrl = '/uploads/vitrina-exists-test/real.png';
  const missingUrl = '/uploads/vitrina-exists-test/orphan.png';

  beforeAll(async () => {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'real.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('localUploadFileExists resolves true for a real file, false for a missing one', async () => {
    await expect(localUploadFileExists(existingUrl)).resolves.toBe(true);
    await expect(localUploadFileExists(missingUrl)).resolves.toBe(false);
  });

  it('localUploadFileExists rejects path traversal instead of resolving outside uploads/', async () => {
    await expect(localUploadFileExists('/uploads/../../etc/passwd')).resolves.toBe(false);
  });

  it('blankMissingUploadUrls blanks storageUrl only on docs whose file is missing', async () => {
    const real = { storageUrl: existingUrl };
    const orphan = { storageUrl: missingUrl };
    const empty = { storageUrl: '' };
    await blankMissingUploadUrls([real, orphan, empty, undefined]);
    expect(real.storageUrl).toBe(existingUrl);
    expect(orphan.storageUrl).toBe('');
    expect(empty.storageUrl).toBe('');
  });

  it('blankMissingUploadUrls dedupes repeated URLs to a single disk check', async () => {
    const docs = Array.from({ length: 5 }, () => ({ storageUrl: missingUrl }));
    await blankMissingUploadUrls(docs);
    expect(docs.every((doc) => doc.storageUrl === '')).toBe(true);
  });
});
