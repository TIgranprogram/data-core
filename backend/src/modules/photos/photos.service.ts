import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Photo, PhotoDocument, PhotoFrame } from './photo.schema';
import { decodeMulterOriginalName } from './image-upload.options';

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? './uploads';
}

export interface CreatePhotoDto {
  storageUrl: string;
  originalFilename?: string;
  variant?: 'original' | 'full' | 'medium' | 'thumb';
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  alt?: string;
  parentPhotoId?: string;
  frame?: Partial<PhotoFrame>;
}

/** Только кадр — PATCH /photos/:id/frame без перезагрузки файла. */
export interface UpdatePhotoFrameDto {
  frame: Partial<PhotoFrame>;
}

export interface UploadedPhotoFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface PhotoVariantSummary {
  _id: string;
  storageUrl: string;
  variant: 'thumb';
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface PhotoUploadResult {
  original: PhotoDocument;
  thumb?: PhotoVariantSummary;
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @InjectModel(Photo.name) private readonly model: Model<PhotoDocument>,
  ) {}

  async create(dto: CreatePhotoDto): Promise<PhotoDocument> {
    return this.model.create({
      ...dto,
      parentPhotoId: dto.parentPhotoId ? new Types.ObjectId(dto.parentPhotoId) : undefined,
    });
  }

  /**
   * Сохранить/обновить кадр показа (TZ-PHOTO-304). Частичное обновление:
   * переданные ключи мержатся поверх текущего frame (или default contain/center).
   */
  async updateFrame(id: string, dto: UpdatePhotoFrameDto): Promise<PhotoDocument> {
    const doc = await this.findById(id);
    const current = doc.frame ?? { fit: 'contain' as const, posX: 50, posY: 50 };
    doc.frame = { ...current, ...dto.frame };
    await doc.save();
    return doc;
  }

  /**
   * Persist the uploaded original first, then generate a separate list thumb.
   * A sharp failure is deliberately non-fatal: the original remains usable.
   */
  async upload(file: UploadedPhotoFile): Promise<PhotoUploadResult> {
    const originalFilename = decodeMulterOriginalName(file.originalname);
    const original = await this.create({
      storageUrl: `/uploads/${file.filename}`,
      originalFilename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      variant: 'original',
    });
    const thumbFilename = `${randomUUID()}.webp`;
    const thumbPath = join(uploadDir(), thumbFilename);
    const originalPath = join(uploadDir(), file.filename);

    try {
      const output = await sharp(originalPath)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(thumbPath);
      const thumb = await this.create({
        storageUrl: `/uploads/${thumbFilename}`,
        originalFilename,
        variant: 'thumb',
        mimeType: 'image/webp',
        sizeBytes: output.size,
        widthPx: output.width,
        heightPx: output.height,
        parentPhotoId: original._id.toString(),
      });

      return { original, thumb: this.toThumbSummary(thumb) };
    } catch (error) {
      this.logger.warn(
        `Failed to generate thumb for ${file.filename}: ${(error as Error).message}`,
      );
      try {
        await fs.unlink(thumbPath);
      } catch {
        // No partial thumb is expected when sharp fails, but cleanup is best effort.
      }
      return { original };
    }
  }

  private toThumbSummary(photo: PhotoDocument): PhotoVariantSummary {
    return {
      _id: photo._id.toString(),
      storageUrl: photo.storageUrl,
      variant: 'thumb',
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
    };
  }

  async findAll(): Promise<PhotoDocument[]> {
    return this.model.find().sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<PhotoDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Photo ${id} not found`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Photo ${id} not found`);
    return doc;
  }

  async findByIds(ids: string[]): Promise<PhotoDocument[]> {
    return this.model
      .find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .exec();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await doc.deleteOne();
    // Best-effort cleanup of the physical file. If the file is missing or
    // we lack permission, log a warning but don't fail the request — DB
    // record is the source of truth. Physical-file leaks are bounded by
    // a follow-up `scripts/cleanup-orphan-uploads.ts` (TODO).
    if (doc.storageUrl?.startsWith('/uploads/')) {
      const filename = doc.storageUrl.slice('/uploads/'.length);
      const filePath = join(uploadDir(), filename);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
          this.logger.warn(
            `Failed to unlink ${filePath}: ${(err as Error).message}`,
          );
        }
      }
    }
  }
}
