import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Model, Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { uploadsRoot } from '../../common/uploads/safe-path';
import { DownloadTickets } from '../productattachments/download-tickets';
import { PDM_DOC_KINDS, PDM_OWNER_KINDS, PdmFile, type PdmDocKind, type PdmFileDocument, type PdmOwnerKind } from './pdm-file.schema';
import { assertPdmContent, pdmAbs, pdmRel, pdmTicketUrl, pdmUrl } from './pdm-paths';

/** Метаданные файла от приложения (CONTRACT §3 «Файлы»). Запись в коллекцию — только через `save` сервиса импорта. */
export interface PdmFileInput {
  ownerKind: string; ownerId: string; designation: string; docKind: string; name: string;
  pdmVersion: number; pdmFileId?: number; pdmState?: string; modified?: string; sha256?: string;
}

type Row = Record<string, unknown> & { _id: Types.ObjectId; designation: string; docKind: string; path: string };

@Injectable()
export class PdmFilesService {
  constructor(@InjectModel(PdmFile.name) private readonly model: Model<PdmFileDocument>) {}

  private readonly tickets = new DownloadTickets();

  private orgFilter(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? { organizationId: oid(organizationId, 'организации') } : {};
  }

  /** Файл на диске по id записи (с учётом организации). Нет записи или файла — 404. */
  async file(id: string, organizationId?: string | null): Promise<{ id: string; abs: string; size: number; name: string }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Файл PDM не найден.');
    const doc = (await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.orgFilter(organizationId) }).select('path name').lean().exec()) as { _id: Types.ObjectId; path?: string; name?: string } | null;
    if (!doc?.path) throw new NotFoundException('Файл PDM не найден.');
    const abs = pdmAbs(uploadsRoot(), doc.path);
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException('Файл не найден на сервере. Сообщите администратору.');
    return { id: String(doc._id), abs, size: st.size, name: String(doc.name ?? 'file') };
  }

  /** Одноразовая ссылка (60 с) для браузера: `<a href>` не шлёт заголовок авторизации. */
  async ticket(id: string, userId: string, organizationId?: string | null) {
    const f = await this.file(id, organizationId);
    const t = this.tickets.issue(f.id, userId);
    return { ...t, url: pdmTicketUrl(f.id, t.ticket) };
  }

  /** Погасить тикет и вернуть файл. Чужой, просроченный или повторный тикет — 403. */
  async fileByTicket(id: string, ticket: string) {
    const f = await this.file(id);
    if (!this.tickets.consume(ticket, f.id)) throw new HttpException('Ссылка на скачивание устарела. Нажмите кнопку ещё раз.', 403);
    return f;
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

  /** Какие из файлов (обозначение + вид + sha256) ещё не лежат на сервере: список sha256 без повторов — для needFiles. */
  async missingSha(docs: Array<{ designation: string; docKind: string; sha256: string }>, organizationId?: string | null): Promise<string[]> {
    if (!docs.length) return [];
    const rows = (await this.model.find({ sha256: { $in: docs.map((d) => d.sha256.toLowerCase()) }, deletedAt: null, ...this.orgFilter(organizationId) }).select('designation docKind sha256').lean().exec()) as unknown as Array<{ designation: string; docKind: string; sha256: string }>;
    const have = new Set(rows.map((r) => `${r.designation}|${r.docKind}|${r.sha256}`));
    return [...new Set(docs.filter((d) => !have.has(`${d.designation}|${d.docKind}|${d.sha256.toLowerCase()}`)).map((d) => d.sha256.toLowerCase()))];
  }

  /** Текущие файлы владельца; у каждого — `versions` (все версии по этому обозначению и виду, новые первыми). */
  async list(ownerKind: unknown, ownerId: unknown, organizationId?: string | null) {
    if (!PDM_OWNER_KINDS.includes(ownerKind as PdmOwnerKind)) throw new BadRequestException('Укажите ownerKind: product, module или material');
    const rows = (await this.model.find({ ownerKind, ownerId: oid(ownerId, 'владельца'), deletedAt: null, ...this.orgFilter(organizationId) }).sort({ pdmVersion: -1 }).lean().exec()) as unknown as Row[];
    // путь на диске клиенту не отдаём — только ссылка
    const view = (r: Row) => { const out: Record<string, unknown> = { ...r, url: pdmUrl(String(r._id)) }; for (const k of ['path', 'deletedAt', '__v']) delete out[k]; return out; };
    const items = rows.filter((r) => r.isCurrent).map((r) => ({ ...view(r), versions: rows.filter((v) => v.designation === r.designation && v.docKind === r.docKind).map(view) }));
    return { items, total: items.length };
  }
}
