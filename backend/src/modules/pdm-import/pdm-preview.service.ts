import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProductModule as ProductModuleEntity, type ProductModuleDocument } from '../../common/catalog/product-module.schema';
import { Product, type ProductDocument } from '../../common/catalog/product.schema';
import { oid } from '../../common/list-query';
import { Material, type MaterialDocument } from '../material/material.schema';
import { IMAGE_UPLOAD_MAX_BYTES, uploadFileName } from '../photos/image-upload.options';
import { Photo, type PhotoDocument } from '../photos/photo.schema';
import { PhotosService } from '../photos/photos.service';
import type { PdmPreviewFormDto, PdmTreeDto } from './dto/pdm-tree.dto';
import { PdmImport, type PdmImportDocument } from './pdm-import.schema';

export interface PreviewImageResult { photoId: string; stored: boolean; main: boolean }
type Owner = { _id: Types.ObjectId; photoIds?: Types.ObjectId[]; mainPhotoId?: Types.ObjectId | null };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]), JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Тип картинки по первым байтам (PNG или JPEG); имя и заголовок от клиента не доверяем. */
export function imageTypeOf(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.subarray(0, 4).equals(PNG)) return 'image/png';
  return buf.subarray(0, 3).equals(JPEG) ? 'image/jpeg' : null;
}

/** C057: картинки-превью из приложения PDM → фото изделия, модуля или детали (`POST /pdm-import/preview-image`). */
@Injectable()
export class PdmPreviewService {
  constructor(
    @InjectModel(PdmImport.name) private readonly imports: Model<PdmImportDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    @InjectModel(ProductModuleEntity.name) private readonly modules: Model<ProductModuleDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Photo.name) private readonly photos: Model<PhotoDocument>,
    private readonly photoService: PhotosService,
  ) {}

  private ownerModel(kind: string): Model<Owner> {
    return (kind === 'product' ? this.products : kind === 'module' ? this.modules : this.materials) as unknown as Model<Owner>;
  }

  async save(form: PdmPreviewFormDto, buf: Buffer, user: AuthenticatedUser): Promise<PreviewImageResult> {
    const org = user.organizationId ? { organizationId: oid(user.organizationId, 'организации') } : {};
    const imp = (await this.imports.findOne({ _id: oid(form.importId, 'загрузки'), ...org }).lean().exec()) as (PdmImport & { _id: Types.ObjectId }) | null;
    if (!imp) throw new NotFoundException('Загрузка не найдена');
    if (imp.status !== 'applied') throw new ConflictException('Сначала примените загрузку, потом отправляйте картинки');
    const inPlan = (imp.tree as unknown as PdmTreeDto).items.some((i) => i.designation === form.designation);
    const ref = imp.owners?.[form.designation];
    if (!inPlan || !ref) throw new BadRequestException('Такого обозначения нет в загруженном дереве');
    const mime = imageTypeOf(buf);
    if (!mime) throw new BadRequestException('Картинка должна быть PNG или JPEG');
    if (buf.length > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException('Картинка больше 10 МБ');
    const sha = form.sha256.toLowerCase();
    if (createHash('sha256').update(buf).digest('hex') !== sha) throw new BadRequestException('Контрольная сумма картинки не совпадает');

    const model = this.ownerModel(ref.kind);
    const owner = (await model.findOne({ _id: ref.id }).select('photoIds mainPhotoId').lean().exec()) as Owner | null;
    if (!owner) throw new NotFoundException('Владелец картинки не найден');
    const have = owner.photoIds ?? [];
    const same = have.length ? ((await this.photos.findOne({ _id: { $in: have }, sha256: sha }).select('_id').lean().exec()) as { _id: Types.ObjectId } | null) : null;
    const isMain = async (id: Types.ObjectId | null | undefined) => !id || !!(await this.photos.exists({ _id: id, source: 'pdm' }));
    if (same) return { photoId: String(same._id), stored: false, main: String(owner.mainPhotoId ?? '') === String(same._id) };

    // Мультер здесь не нужен: кладём файл туда, куда его кладёт POST /photos/upload, и отдаём тому же сервису (превью thumb/medium).
    const dir = process.env.UPLOAD_DIR ?? './uploads', filename = uploadFileName(mime);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, filename), buf);
    const { original } = await this.photoService.upload({ filename, originalname: `${form.designation}.${mime === 'image/png' ? 'png' : 'jpg'}`, mimetype: mime, size: buf.length }, 'showcase');
    await this.photos.updateOne({ _id: original._id }, { $set: { source: 'pdm', sha256: sha } }).exec();

    // Фото менеджера не перебиваем: главным становится, только если главного нет или оно тоже из PDM
    const main = await isMain(owner.mainPhotoId);
    await model.updateOne({ _id: ref.id }, { $addToSet: { photoIds: original._id }, ...(main ? { $set: { mainPhotoId: original._id } } : {}) }).exec();
    return { photoId: String(original._id), stored: true, main };
  }
}
