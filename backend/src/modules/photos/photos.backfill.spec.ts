import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import sharp from 'sharp';
import {
  backfillPhotoThumbs,
  type PhotoBackfillReport,
} from '../../../scripts/tz-photo-303-backfill-thumbs';

type FakePhoto = {
  _id: Types.ObjectId;
  storageUrl: string;
  originalFilename?: string;
  variant: 'original' | 'thumb';
  parentPhotoId?: Types.ObjectId;
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
};

function fakeModel(records: FakePhoto[]) {
  return {
    find: jest.fn(() => ({ exec: async () => records.filter((photo) => photo.variant === 'original') })),
    exists: jest.fn(async (filter: { $or: { parentPhotoId: Types.ObjectId }[] }) =>
      records.some(
        (photo) =>
          photo.variant === 'thumb' &&
          filter.$or.some((candidate) => photo.parentPhotoId?.equals(candidate.parentPhotoId)),
      ),
    ),
    create: jest.fn(async (payload: Omit<FakePhoto, '_id'>) => {
      const created = { _id: new Types.ObjectId(), ...payload };
      records.push(created);
      return created;
    }),
  };
}

describe('TZ-PHOTO-303 legacy thumb backfill', () => {
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'kppdf-photo-backfill-'));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('creates a linked thumb and is idempotent on the second run', async () => {
    const originalBytes = await sharp({
      create: {
        width: 640,
        height: 400,
        channels: 3,
        background: { r: 80, g: 150, b: 210 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(join(uploadDir, 'legacy.png'), originalBytes);
    const records: FakePhoto[] = [
      {
        _id: new Types.ObjectId(),
        storageUrl: '/uploads/legacy.png',
        originalFilename: 'legacy.png',
        variant: 'original',
      },
    ];
    const model = fakeModel(records);
    const log = jest.fn();

    const first = await backfillPhotoThumbs(model as never, { uploadDir, log });
    expect(first).toEqual<PhotoBackfillReport>({
      scanned: 1,
      created: 1,
      skippedExisting: 0,
      skippedMissing: 0,
      skippedUnsupported: 0,
      failed: 0,
    });
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual(
      expect.objectContaining({
        variant: 'thumb',
        parentPhotoId: records[0]._id,
        mimeType: 'image/webp',
      }),
    );
    const thumbFilename = records[1].storageUrl.replace('/uploads/', '');
    const thumbMetadata = await sharp(await readFile(join(uploadDir, thumbFilename))).metadata();
    expect(Math.max(thumbMetadata.width ?? 0, thumbMetadata.height ?? 0)).toBeLessThanOrEqual(320);
    expect(await readFile(join(uploadDir, 'legacy.png'))).toEqual(originalBytes);

    const second = await backfillPhotoThumbs(model as never, { uploadDir, log });
    expect(second).toEqual<PhotoBackfillReport>({
      scanned: 1,
      created: 0,
      skippedExisting: 1,
      skippedMissing: 0,
      skippedUnsupported: 0,
      failed: 0,
    });
    expect(records).toHaveLength(2);
  });

  it('skips missing files and continues the run', async () => {
    const records: FakePhoto[] = [
      {
        _id: new Types.ObjectId(),
        storageUrl: '/uploads/missing.png',
        variant: 'original',
      },
    ];
    const model = fakeModel(records);
    const log = jest.fn();

    const report = await backfillPhotoThumbs(model as never, { uploadDir, log });

    expect(report).toEqual<PhotoBackfillReport>({
      scanned: 1,
      created: 0,
      skippedExisting: 0,
      skippedMissing: 1,
      skippedUnsupported: 0,
      failed: 0,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('missing file'));
    expect(records).toHaveLength(1);
  });
});
