import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Model, Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { uploadsRoot } from '../../common/uploads/safe-path';
import { PDM_DOC_KINDS, PDM_OWNER_KINDS, PdmFile, type PdmDocKind, type PdmFileDocument, type PdmOwnerKind } from './pdm-file.schema';
import { assertPdmContent, pdmAbs, pdmRel, pdmUrl } from './pdm-paths';

/** Метаданные файла от приложения (CONTRACT §3 «Файлы»). Запись в коллекцию — только через `save` сервиса импорта. */
export interface PdmFileInput {
  ownerKind: string; ownerId: string; designation: string; docKind: string; name: string;
  pdmVersion: number; pdmFileId?: number; pdmState?: string; modified?: string; sha256?: string;
}

type Row = Record<string, unknown> & { _id: Types.ObjectId; designation: string; docKind: string; path: string };

@Injectable()
export class PdmFilesService {
  constructor(@InjectModel(PdmFile.name) private readonly model: Model<PdmFileDocument>) {}

  private orgFilter(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? { organizationId: oid(organizationId, 'организации') } : {};
  }

  /**
   * Сохранить файл версии. Повтор с тем же содержимым — `stored:false` (на диск второй раз не пишем).
   * Другое содержимое под той же версией — 409. Контрольную сумму считает сервер и сверяет с присланной.
   */
  async save(input: PdmFileInput, buf: Buffer, organizationId?: string | null): Promise<{ id: string; stored: boolean }> {
    const ownerKind = input.ownerKind as PdmOwnerKind, docKind = input.docKind as PdmDocKind;
    if (!PDM_OWNER_KINDS.includes(ownerKind)) throw new BadRequestException('Неизвестный владелец файла');
    if (!PDM_DOC_KINDS.includes(docKind)) throw new BadRequestException('Неизвестный вид документа');
    const rel = pdmRel(input.designation, input.pdmVersion, input.name);
    assertPdmContent(docKind, input.name, buf);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    if (input.sha256 && input.sha256.toLowerCase() !== sha256) throw new BadRequestException('Контрольная сумма не совпала — отправьте файл ещё раз');

    const org = this.orgFilter(organizationId), key = { ...org, designation: input.designation, docKind };
    const same = await this.model.findOne({ ...key, sha256, deletedAt: null }).select('_id').lean().exec();
    if (same) return { id: String(same._id), stored: false };
    if (await this.model.exists({ ...key, pdmVersion: input.pdmVersion })) throw new ConflictException('Эта версия файла уже загружена с другим содержимым');

    const abs = pdmAbs(uploadsRoot(), rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);

    const newest = await this.model.findOne({ ...key, deletedAt: null }).sort({ pdmVersion: -1 }).select('pdmVersion').lean().exec();
    const isCurrent = !newest || input.pdmVersion >= newest.pdmVersion;
    if (isCurrent) await this.model.updateMany({ ...key, isCurrent: true }, { $set: { isCurrent: false } }).exec();
    const modified = input.modified ? new Date(input.modified) : undefined;
    const doc = await this.model.create({
      ownerKind, ownerId: oid(input.ownerId, 'владельца'), designation: input.designation, docKind, name: input.name,
      pdmVersion: input.pdmVersion, ...(input.pdmFileId != null ? { pdmFileId: input.pdmFileId } : {}), ...(input.pdmState ? { pdmState: input.pdmState } : {}),
      ...(modified && !Number.isNaN(+modified) ? { modified } : {}), sha256, size: buf.length, path: rel, isCurrent,
      ...(organizationId ? { organizationId: oid(organizationId, 'организации') } : {}),
    });
    return { id: String(doc._id), stored: true };
  }

  /** Текущие файлы владельца; у каждого — `versions` (все версии по этому обозначению и виду, новые первыми). */
  async list(ownerKind: unknown, ownerId: unknown, organizationId?: string | null) {
    if (!PDM_OWNER_KINDS.includes(ownerKind as PdmOwnerKind)) throw new BadRequestException('Укажите ownerKind: product, module или material');
    const rows = (await this.model.find({ ownerKind, ownerId: oid(ownerId, 'владельца'), deletedAt: null, ...this.orgFilter(organizationId) }).sort({ pdmVersion: -1 }).lean().exec()) as unknown as Row[];
    // путь на диске клиенту не отдаём — только ссылка
    const view = (r: Row) => { const out: Record<string, unknown> = { ...r, url: pdmUrl(r.path) }; for (const k of ['path', 'deletedAt', '__v']) delete out[k]; return out; };
    const items = rows.filter((r) => r.isCurrent).map((r) => ({ ...view(r), versions: rows.filter((v) => v.designation === r.designation && v.docKind === r.docKind).map(view) }));
    return { items, total: items.length };
  }
}
