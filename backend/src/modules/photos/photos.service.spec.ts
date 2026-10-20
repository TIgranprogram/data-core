import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { PhotosService } from './photos.service';

type PhotoPayload = {
  storageUrl: string;
  variant?: string;
  parentPhotoId?: string | Types.ObjectId;
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  frame?: { fit?: string; posX?: number; posY?: number };
};

function buildPhotoDocument(payload: PhotoPayload) {
  const document = {
    _id: new Types.ObjectId(),
    ...payload,
    toObject: () => document,
  };
  return document;
}

describe('PhotosService upload variants', () => {
  let service: PhotosService;
  let model: { create: jest.Mock };
  let uploadDirectory: string;
  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    previousUploadDir = process.env.UPLOAD_DIR;
    uploadDirectory = await mkdtemp(join(tmpdir(), 'kppdf-photo-'));
    process.env.UPLOAD_DIR = uploadDirectory;
    model = {
      create: jest.fn(async (payload: PhotoPayload) => buildPhotoDocument(payload)),
    };
    service = new PhotosService(model as never);
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await rm(uploadDirectory, { recursive: true, force: true });
  });

  it('keeps the original and creates a linked 320px thumb', async () => {
    const originalBytes = await sharp({
      create: {
        width: 640,
        height: 400,
        channels: 3,
        background: { r: 220, g: 180, b: 80 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(join(uploadDirectory, 'original.png'), originalBytes);

    const result = await service.upload({
      filename: 'original.png',
      originalname: 'product.png',
      mimetype: 'image/png',
      size: originalBytes.length,
    });

    expect(model.create).toHaveBeenCalledTimes(2);
    expect(model.create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ variant: 'original', storageUrl: '/uploads/original.png' }),
    );
    const thumbPayload = model.create.mock.calls[1][0] as PhotoPayload;
    expect(thumbPayload.variant).toBe('thumb');
    expect(thumbPayload.mimeType).toBe('image/webp');
    expect(thumbPayload.parentPhotoId?.toString()).toBe(result.original._id.toString());
    expect(result.thumb?.storageUrl).toBe(thumbPayload.storageUrl);

    const thumbBytes = await readFile(join(uploadDirectory, basename(thumbPayload.storageUrl)));
    const thumbMetadata = await sharp(thumbBytes).metadata();
    expect(Math.max(thumbMetadata.width ?? 0, thumbMetadata.height ?? 0)).toBeLessThanOrEqual(320);
    expect(await readFile(join(uploadDirectory, 'original.png'))).toEqual(originalBytes);
  });

  it('stores a decoded Cyrillic originalFilename instead of latin1 mojibake', async () => {
    const originalBytes = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(join(uploadDirectory, 'cyr.png'), originalBytes);
    const mojibake = Buffer.from('Снимок экрана.png', 'utf8').toString('latin1');

    await service.upload({
      filename: 'cyr.png',
      originalname: mojibake,
      mimetype: 'image/png',
      size: originalBytes.length,
    });

    expect(model.create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ originalFilename: 'Снимок экрана.png' }),
    );
  });

  it('returns the original and does not fail when sharp cannot decode the file', async () => {
    await writeFile(join(uploadDirectory, 'broken.png'), Buffer.from('not an image'));

    const result = await service.upload({
      filename: 'broken.png',
      originalname: 'broken.png',
      mimetype: 'image/png',
      size: 12,
    });

    expect(model.create).toHaveBeenCalledTimes(1);
    expect(result.thumb).toBeUndefined();
    expect(result.original.storageUrl).toBe('/uploads/broken.png');
  });
});

describe('PhotosService frame (TZ-PHOTO-304)', () => {
  function buildDoc(overrides: Partial<PhotoPayload> = {}) {
    const document = {
      _id: new Types.ObjectId(),
      frame: { fit: 'contain', posX: 50, posY: 50 },
      ...overrides,
      save: jest.fn(async function () {
        return this;
      }),
      toObject: () => document,
    };
    return document as never;
  }

  function buildModel(doc: unknown) {
    return {
      create: jest.fn(),
      findById: jest.fn(() => ({ exec: async () => doc })),
    };
  }

  it('merges partial frame keys over the default contain/center frame', async () => {
    const doc = buildDoc();
    const model = buildModel(doc);
    const service = new PhotosService(model as never);
    const id = new Types.ObjectId().toString();

    const result = await service.updateFrame(id, { frame: { posX: 25 } });

    expect(model.findById).toHaveBeenCalledWith(id);
    expect((result as { frame: { fit: string; posX: number; posY: number } }).frame).toEqual({
      fit: 'contain',
      posX: 25,
      posY: 50,
    });
    expect((doc as { save: jest.Mock }).save).toHaveBeenCalled();
  });

  it('defaults to contain/center when the photo has no frame yet', async () => {
    const doc = buildDoc({ frame: undefined });
    const model = buildModel(doc);
    const service = new PhotosService(model as never);
    const id = new Types.ObjectId().toString();

    const result = await service.updateFrame(id, { frame: { fit: 'cover', posY: 80 } });

    expect((result as { frame: { fit: string; posX: number; posY: number } }).frame).toEqual({
      fit: 'cover',
      posX: 50,
      posY: 80,
    });
  });
});
