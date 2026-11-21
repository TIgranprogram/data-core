import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types, type ClientSession } from 'mongoose';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { PDF_MIME } from './image-upload.options';
import { Photo, PhotoDocument, PHOTO_INTAKE_UID_INDEX } from './photo.schema';
import {
  fileErrorCode,
  inspectIntakePdf,
  type IntakeUploadFile,
  PHOTO_INTAKE_URL_PREFIX,
  publishIntakePdf,
  syncIntakeDirectory,
} from './photo-intake.storage';

type Reservation = Pick<Photo,
  'storageUrl' | 'deletedAt' | 'sourceDeleting' | 'sourceProtected' | 'sizeBytes' | 'intakeUid' | 'intakeAccount' | 'sha256'
> & { _id: Types.ObjectId };

export interface PhotoIntakeReceipt {
  uid: string;
  sha256: string;
  fileId: string;
  storageUrl: string;
}

@Injectable()
export class PhotoIntakeService {
  constructor(@InjectModel(Photo.name) private readonly photos: Model<PhotoDocument>) {}

  async upload(uid: string, sha256: string, account: string, file?: IntakeUploadFile): Promise<PhotoIntakeReceipt> {
    if (!file || file.size < 5) throw new BadRequestException('Выберите действительный PDF');
    await this.assertUniqueIndex();
    let reservation = await this.findReservation({ intakeUid: uid });
    if (reservation) this.assertBinding(reservation, account, sha256);

    const uploaded = await inspectIntakePdf(file.path, file.size);
    if (!uploaded?.pdf) throw new BadRequestException('Содержимое файла не похоже на PDF');
    if (uploaded.sha256 !== sha256) throw new BadRequestException('Контрольная сумма загруженного PDF не совпадает');

    reservation ??= await this.reserve(uid, sha256, account, file);
    this.assertBinding(reservation, account, sha256);
    const existing = await this.proveReceipt(reservation);
    if (existing) return existing;
    const path = this.originalPath(reservation);
    await publishIntakePdf(file.path, path);
    return this.readProvenReceipt(reservation);
  }

  async receipt(uid: string, account: string): Promise<PhotoIntakeReceipt> {
    await this.assertUniqueIndex();
    const reservation = await this.findReservation({ intakeUid: uid });
    if (!reservation) throw new NotFoundException('Квитанция оригинала не найдена');
    this.assertBinding(reservation, account);
    return this.readProvenReceipt(reservation);
  }

  /** Снабжение принимает уже зарезервированный и физически проверенный PDF этого аккаунта. */
  async assertOriginal(fileId: Types.ObjectId, sha256: string, account: string): Promise<number> {
    const reservation = await this.findReservation({ _id: fileId });
    if (!reservation?.intakeUid) throw new BadRequestException('Сначала загрузите оригинал через загрузчик документов');
    this.assertBinding(reservation, account, sha256);
    await this.readProvenReceipt(reservation);
    return reservation.sizeBytes!;
  }

  async createReviewed(fileId: string, uid: string, sha256: string, size: number, actor: string, storageUrl: string, session: ClientSession) {
    await this.photos.create([{
      _id: new Types.ObjectId(fileId), intakeUid: uid, intakeAccount: actor, sha256, sizeBytes: size,
      storageUrl, originalFilename: 'original.pdf', sourceProtected: true, mimeType: PDF_MIME, variant: 'original',
    }], { session });
  }

  async reviewedPath(fileId: string): Promise<string | null> {
    const url = '/uploads/reviewed-invoices/' + fileId + '.pdf';
    const photo = await this.photos.exists({ _id: fileId, storageUrl: url, sourceProtected: true, deletedAt: null })
      .readConcern('majority').exec();
    return photo ? safeUploadPath(url) : null;
  }

  async assertUniqueIndex(): Promise<void> {
    const indexes = await this.photos.collection.indexes().catch(() => []);
    const ready = indexes.some(index => index.name === PHOTO_INTAKE_UID_INDEX
      && Object.keys(index.key).length === 1 && index.key.intakeUid === 1
      && index.unique === true && index.sparse === true
      && !index.partialFilterExpression && !index.hidden && index.expireAfterSeconds === undefined
      && (!index.collation || index.collation.locale === 'simple'));
    if (!ready) throw new ServiceUnavailableException('Индекс загрузки оригиналов ещё не подготовлен');
  }

  private findReservation(filter: { intakeUid: string } | { _id: Types.ObjectId }): Promise<Reservation | null> {
    return this.photos.findOne(filter)
      .setOptions({ includeSoftDeleted: true })
      .select('+intakeUid +intakeAccount')
      // Видим подтверждённую резервацию сразу после записи, даже при отставании снимка majority.
      .readConcern('linearizable')
      .maxTimeMS(5_000)
      .lean()
      .exec();
  }

  private async reserve(uid: string, sha256: string, account: string, file: IntakeUploadFile): Promise<Reservation> {
    // Путь раздачи строится по ID. Случайный ID сохраняет непредсказуемость ссылок на оригиналы.
    const id = new Types.ObjectId(randomBytes(12));
    try {
      const [reservation] = await this.photos.create([{
        _id: id,
        intakeUid: uid,
        intakeAccount: account,
        storageUrl: `${PHOTO_INTAKE_URL_PREFIX}${id}.pdf`,
        originalFilename: file.originalname,
        variant: 'original',
        mimeType: PDF_MIME,
        sha256,
        sizeBytes: file.size,
        sourceProtected: true,
      }], { w: 'majority', j: true, wtimeout: 5_000 });
      return reservation;
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) throw error;
      const winner = await this.findReservation({ intakeUid: uid });
      if (!winner) throw new ServiceUnavailableException('Резервирование оригинала ещё подтверждается — повторите сверку');
      return winner;
    }
  }

  private assertBinding(reservation: Reservation, account: string, sha256?: string): void {
    if (reservation.intakeAccount !== account
      || (sha256 !== undefined && reservation.sha256 !== sha256)
      || reservation.deletedAt || reservation.sourceDeleting || reservation.sourceProtected !== true) {
      throw new ConflictException('Ключ оригинала уже занят другим файлом или аккаунтом либо запись недоступна');
    }
  }

  private originalPath(reservation: Reservation): string {
    const expected = `${PHOTO_INTAKE_URL_PREFIX}${reservation._id}.pdf`;
    const reviewed = '/uploads/reviewed-invoices/' + reservation._id + '.pdf';
    const path = (reservation.storageUrl === expected || reservation.storageUrl === reviewed) && safeUploadPath(reservation.storageUrl);
    if (!path) throw new ConflictException('Путь зарезервированного оригинала изменился');
    return path;
  }

  private async readProvenReceipt(reservation: Reservation): Promise<PhotoIntakeReceipt> {
    const receipt = await this.proveReceipt(reservation);
    if (!receipt) throw new NotFoundException('Файл оригинала ещё не сохранён');
    return receipt;
  }

  private async proveReceipt(reservation: Reservation): Promise<PhotoIntakeReceipt | null> {
    const path = this.originalPath(reservation);
    const bytes = await inspectIntakePdf(path, reservation.sizeBytes ?? 0);
    if (!bytes) return null;
    if (!bytes.pdf || bytes.sha256 !== reservation.sha256 || !reservation.intakeUid) {
      throw new ConflictException('Контрольная сумма сохранённого оригинала отличается');
    }
    try {
      await syncIntakeDirectory(path);
    } catch (error) {
      if (fileErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
    return {
      uid: reservation.intakeUid,
      sha256: bytes.sha256,
      fileId: String(reservation._id),
      storageUrl: reservation.storageUrl,
    };
  }
}
