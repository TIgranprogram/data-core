import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { safeUploadPath } from '../../common/uploads/safe-path';
import sharp from 'sharp';
import { shrinkInPlace } from './image-shrink';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Photo, PhotoDocument, PhotoFrame } from './photo.schema';
import { decodeMulterOriginalName, IMAGE_UPLOAD_MAX_BYTES, PDF_MIME } from './image-upload.options';
import { buildRotatedCopy } from './image-orientation';

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
  /** Повёрнутая по EXIF копия (только если у оригинала Orientation ≠ 1). */
  full?: Omit<PhotoVariantSummary, 'variant'> & { variant: 'full' };
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
    const originalPath = join(uploadDir(), file.filename);
    if (file.mimetype === PDF_MIME) return this.uploadPdf(file, originalPath, originalFilename);
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      await fs.unlink(originalPath).catch(() => undefined);
      throw new BadRequestException('Картинка больше 10 МБ');
    }
    // тяжёлое фото (> 2560 px или > 3 МБ) облегчаем на месте — дальше его тянут карточки, галереи и PDF
    const shrunk = await shrinkInPlace(originalPath, file.mimetype, file.size);
    const original = await this.create({
      storageUrl: `/uploads/${file.filename}`,
      originalFilename,
      mimeType: file.mimetype,
      sizeBytes: shrunk ?? file.size,
      variant: 'original',
    });
    const thumbFilename = `${randomUUID()}.webp`;
    const thumbPath = join(uploadDir(), thumbFilename);

    // Повёрнутая копия — отдельный файл; сбой не фатален, оригинал остаётся.
    let full: PhotoUploadResult['full'];
    let fullFilePath: string | undefined;
    try {
      const { rotated } = await buildRotatedCopy(originalPath);
      if (rotated) {
        const fullFilename = `${randomUUID()}-full.${rotated.ext}`;
        fullFilePath = join(uploadDir(), fullFilename);
        await fs.writeFile(fullFilePath, rotated.data);
        const doc = await this.create({
          storageUrl: `/uploads/${fullFilename}`,
          originalFilename,
          variant: 'full',
          mimeType: `image/${rotated.format}`,
          sizeBytes: rotated.data.length,
          widthPx: rotated.width,
          heightPx: rotated.height,
          parentPhotoId: original._id.toString(),
        });
        full = { ...this.toThumbSummary(doc), variant: 'full' };
      }
    } catch (error) {
      this.logger.warn(`Failed to rotate ${file.filename}: ${(error as Error).message}`);
      if (fullFilePath) await fs.unlink(fullFilePath).catch(() => undefined);
    }

    try {
      const output = await sharp(originalPath)
        .rotate()
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

      return { original, thumb: this.toThumbSummary(thumb), ...(full ? { full } : {}) };
    } catch (error) {
      this.logger.warn(
        `Failed to generate thumb for ${file.filename}: ${(error as Error).message}`,
      );
      try {
        await fs.unlink(thumbPath);
      } catch {
        // No partial thumb is expected when sharp fails, but cleanup is best effort.
      }
      return { original, ...(full ? { full } : {}) };
    }
  }

  /** PDF: без миниатюры и обработки; проверяем сигнатуру %PDF- (тип от клиента не доверяем). */
  private async uploadPdf(file: UploadedPhotoFile, path: string, originalFilename: string): Promise<PhotoUploadResult> {
    const fh = await fs.open(path, 'r');
    const buf = Buffer.alloc(5);
    try {
      await fh.read(buf, 0, 5, 0);
    } finally {
      await fh.close();
    }
    if (buf.toString('latin1') !== '%PDF-') {
      await fs.unlink(path).catch(() => undefined);
      throw new BadRequestException('Это не PDF');
    }
    const original = await this.create({
      storageUrl: `/uploads/${file.filename}`,
      originalFilename,
      mimeType: PDF_MIME,
      sizeBytes: file.size,
      variant: 'original',
    });
    return { original };
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
    // варианты фото (миниатюра, повёрнутая копия) — отдельные записи со ссылкой parentPhotoId: удаляются вместе (М9)
    const variants = await this.model.find({ parentPhotoId: doc._id }).exec();
    for (const v of variants) await v.deleteOne();
    await doc.deleteOne();
    // Файлы — по возможности: нет файла или прав — предупреждение, запрос не падает (истина — запись в базе).
    // Ссылка не в папку загрузок — файл не трогаем (М1). Остатки без ссылок покажет scripts/orphan-uploads.js.
    for (const url of [doc.storageUrl, ...variants.map((v) => v.storageUrl)]) {
      const filePath = safeUploadPath(url, resolve(uploadDir()));
      if (!filePath) continue;
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
