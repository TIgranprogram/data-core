import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { UserService } from '../user/user.service';

const FILE_LIMIT = 20;
export const DESK_FILE_BYTES = 10 * 1024 * 1024;
const BUCKET = 'private_desk';

type Upload = { originalname: string; buffer: Buffer };
type DeskFile = {
  _id: mongo.ObjectId;
  filename: string;
  length: number;
  uploadDate: Date;
  metadata: { owner: string; task: string; slot?: number; deletedAt?: Date };
};

function nameOf(name: string) {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  const original = Buffer.from(utf8, 'utf8').toString('latin1') === name ? utf8 : name;
  return Array.from(original.normalize().replace(/[\p{Cc}<>:"/\\|?*]/gu, '').trim()).slice(0, 180).join('') || 'Файл';
}

function info(file: DeskFile) {
  const { _id, filename, length, uploadDate, metadata } = file;
  return { id: _id.toHexString(), name: filename, size: length, uploadedAt: uploadDate, deletedAt: metadata.deletedAt };
}

@Injectable()
export class DeskFilesService {
  private slotIndex?: Promise<string>;

  constructor(@InjectConnection() private readonly connection: Connection, private readonly users: UserService) {}

  private get database() { return this.connection.db!; }
  private get files() { return this.database.collection<DeskFile>(BUCKET + '.files'); }

  private async scope(owner: string, task: string) {
    const { items } = await this.users.getDesk(owner);
    if (!items.some((item) => item.of === 'personal' && item.id === task && !item.deletedAt)) {
      throw new NotFoundException('Личная задача не найдена');
    }
    return { 'metadata.owner': owner, 'metadata.task': task };
  }

  async list(owner: string, task: string) {
    const scope = await this.scope(owner, task);
    return (await this.files.find(scope).sort({ uploadDate: -1, _id: -1 }).toArray()).map(info);
  }

  private async uploadSlot(scope: { 'metadata.owner': string; 'metadata.task': string }) {
    // GridFS публикует метаданные после записи частей. Уникальный слот ограничивает именно завершённые загрузки.
    this.slotIndex ??= this.files.createIndex(
      { 'metadata.owner': 1, 'metadata.task': 1, 'metadata.slot': 1 },
      { unique: true, name: 'desk_file_slot', partialFilterExpression: { 'metadata.slot': { $exists: true } } },
    ).catch((error) => { this.slotIndex = undefined; throw error; });
    await this.slotIndex;
    const existing = await this.files.find(scope, { projection: { 'metadata.slot': 1 } }).toArray();
    const used = new Set(existing.flatMap(({ metadata }) => metadata?.slot === undefined ? [] : [metadata.slot]));
    const legacy = existing.length - used.size;
    const available = Array.from({ length: FILE_LIMIT }, (_, slot) => slot).filter((slot) => !used.has(slot));
    if (available.length <= legacy) throw new BadRequestException('В задаче уже 20 файлов, включая удалённые');
    return available[legacy + Math.floor(Math.random() * (available.length - legacy))];
  }

  async upload(owner: string, task: string, file?: Upload) {
    const scope = await this.scope(owner, task);
    if (!file?.buffer.length) throw new BadRequestException('Выберите файл с содержимым');
    const bucket = new mongo.GridFSBucket(this.database, { bucketName: BUCKET });
    const name = nameOf(file.originalname);
    for (let attempt = 0; attempt < FILE_LIMIT; attempt++) {
      const slot = await this.uploadSlot(scope);
      const upload = bucket.openUploadStream(name, { metadata: { owner, task, slot } });
      try {
        await pipeline(Readable.from([file.buffer]), upload);
      } catch (error) {
        await bucket.delete(upload.id).catch(() => undefined);
        if (error instanceof mongo.MongoServerError && error.code === 11000) continue;
        throw error;
      }
      const stored = await this.files.findOne({ ...scope, _id: upload.id });
      if (!stored) throw new NotFoundException('Файл не найден');
      return info(stored);
    }
    throw new ConflictException('Одновременно загружаются файлы. Повторите попытку');
  }

  async download(owner: string, task: string, id: string) {
    const scope = await this.scope(owner, task);
    const file = await this.files.findOne({ ...scope, _id: new mongo.ObjectId(id), 'metadata.deletedAt': null });
    if (!file) throw new NotFoundException('Файл не найден');
    const bucket = new mongo.GridFSBucket(this.database, { bucketName: BUCKET });
    return { file: info(file), stream: bucket.openDownloadStream(file._id) };
  }

  async setDeleted(owner: string, task: string, id: string, deleted: boolean) {
    const scope = await this.scope(owner, task);
    const result = await this.files.findOneAndUpdate(
      { ...scope, _id: new mongo.ObjectId(id) },
      deleted ? { $min: { 'metadata.deletedAt': new Date() } } : { $unset: { 'metadata.deletedAt': 1 } },
      { returnDocument: 'after' },
    );
    if (!result) throw new NotFoundException('Файл не найден');
    return info(result);
  }
}
