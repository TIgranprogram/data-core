/**
 * TZ-PHOTO-303: backfill lightweight thumbnails for legacy original photos.
 *
 * The script only considers Photo records with `variant: 'original'`. For each
 * local `/uploads/...` file it creates one WebP thumb child linked by
 * `parentPhotoId`; originals and their files are never modified or removed.
 * Missing/unsupported/broken files are logged and skipped so one bad upload
 * cannot abort the whole run.
 *
 * Safety / idempotency:
 *   - existing thumb children are detected before any file work;
 *   - the same original is therefore a no-op on every subsequent run;
 *   - a generated file is removed if the database insert fails.
 *
 * Run from `backend/`:
 *   pnpm photos:backfill-thumbs
 *   # or: pnpm exec ts-node scripts/tz-photo-303-backfill-thumbs.ts
 *
 * Environment:
 *   MONGO_URI (optional, defaults to the configured URI)
 *   MONGO_DB (optional, defaults to the configured database)
 *   UPLOAD_DIR (optional, defaults to ./uploads)
 */
import { promises as fs } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { connect, connection, disconnect, Types } from 'mongoose';
import sharp from 'sharp';
import configuration from '../src/config/configuration';
import { Photo, PhotoDocument, PhotoSchema } from '../src/modules/photos/photo.schema';

const ORIGINAL_VARIANT = 'original' as const;
const THUMB_VARIANT = 'thumb' as const;
const UPLOADS_PREFIX = '/uploads/';

export interface PhotoBackfillReport {
  scanned: number;
  created: number;
  skippedExisting: number;
  skippedMissing: number;
  skippedUnsupported: number;
  failed: number;
}

export interface PhotoBackfillOptions {
  uploadDir?: string;
  log?: (message: string) => void;
}

export interface PhotoBackfillModel {
  find(filter: Record<string, unknown>): { exec(): Promise<PhotoDocument[]> };
  exists(filter: Record<string, unknown>): Promise<unknown>;
  create(payload: Record<string, unknown>): Promise<unknown>;
}

function logLine(log: (message: string) => void, message: string): void {
  log(`[tz-photo-303] ${message}`);
}

function safeLocalPhotoPath(storageUrl: string, uploadDir: string): string | null {
  if (!storageUrl.startsWith(UPLOADS_PREFIX)) return null;
  const root = resolve(uploadDir);
  const filePath = resolve(root, storageUrl.slice(UPLOADS_PREFIX.length));
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    return null;
  }
  return filePath;
}

function thumbFilter(originalId: Types.ObjectId): Record<string, unknown> {
  return {
    variant: THUMB_VARIANT,
    $or: [{ parentPhotoId: originalId }, { linkedPhotoId: originalId }],
  };
}

/**
 * Backfill legacy local originals using the same 320px WebP contract as TZ-301.
 * The model is injected to keep the operation deterministic and unit-testable.
 */
export async function backfillPhotoThumbs(
  model: PhotoBackfillModel,
  options: PhotoBackfillOptions = {},
): Promise<PhotoBackfillReport> {
  const uploadDir = options.uploadDir ?? process.env.UPLOAD_DIR ?? './uploads';
  const log = options.log ?? ((message: string) => console.log(message));
  const report: PhotoBackfillReport = {
    scanned: 0,
    created: 0,
    skippedExisting: 0,
    skippedMissing: 0,
    skippedUnsupported: 0,
    failed: 0,
  };

  const originals = await model.find({ variant: ORIGINAL_VARIANT }).exec();
  report.scanned = originals.length;

  for (const original of originals) {
    const originalId = original._id as Types.ObjectId;
    const hasThumb = await model.exists(thumbFilter(originalId));
    if (hasThumb) {
      report.skippedExisting += 1;
      continue;
    }

    const sourcePath = safeLocalPhotoPath(original.storageUrl, uploadDir);
    if (!sourcePath) {
      report.skippedUnsupported += 1;
      logLine(log, `skip ${originalId.toString()}: storage URL is not a safe local upload path`);
      continue;
    }

    try {
      await fs.access(sourcePath);
    } catch {
      report.skippedMissing += 1;
      logLine(log, `skip ${originalId.toString()}: missing file ${sourcePath}`);
      continue;
    }

    const thumbFilename = `${randomUUID()}.webp`;
    const thumbPath = join(resolve(uploadDir), thumbFilename);
    try {
      await fs.mkdir(resolve(uploadDir), { recursive: true });
      const output = await sharp(sourcePath)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(thumbPath);

      await model.create({
        storageUrl: `${UPLOADS_PREFIX}${thumbFilename}`,
        originalFilename: original.originalFilename,
        variant: THUMB_VARIANT,
        mimeType: 'image/webp',
        sizeBytes: output.size,
        widthPx: output.width,
        heightPx: output.height,
        parentPhotoId: originalId,
      });
      report.created += 1;
      logLine(log, `created thumb for ${originalId.toString()} → ${thumbFilename}`);
    } catch (error) {
      report.failed += 1;
      logLine(
        log,
        `skip ${originalId.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await fs.unlink(thumbPath);
      } catch {
        // The file may not have been created; cleanup is best effort.
      }
    }
  }

  return report;
}

async function main(): Promise<void> {
  const cfg = configuration();
  const uri = process.env.MONGO_URI ?? cfg.mongo.uri;
  const dbName = process.env.MONGO_DB ?? cfg.mongo.db;
  // eslint-disable-next-line no-console
  console.log(`[tz-photo-303] connecting to ${uri} (db=${dbName})`);

  try {
    await connect(uri, { dbName, replicaSet: cfg.mongo.replicaSet });
    const model = connection.model(Photo.name, PhotoSchema) as unknown as PhotoBackfillModel;
    const report = await backfillPhotoThumbs(model);
    // eslint-disable-next-line no-console
    console.log(`[tz-photo-303] complete: ${JSON.stringify(report)}`);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[tz-photo-303] FAILED:', error);
    process.exitCode = 1;
  });
}
