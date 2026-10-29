import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { escapeRe, oid } from '../../common/list-query';
import { CreateSupplierContractDto, PatchSupplierContractDto } from './dto-contract';
import { SupplierContract, SupplierContractDocument } from './supplier-contract.schema';

type Lean = Record<string, unknown>;
type InvRef = { id: string; no: string | null };

const dupText = (no: string) => `У этого поставщика уже есть договор № ${no}`;
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

function plural(n: number): string {
  const m = n % 10, h = n % 100;
  return m === 1 && h !== 11 ? 'счёт' : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? 'счёта' : 'счетов';
}

/** Договоры поставщиков (`suppliercontracts`): список/карточка/создание/правка/мягкое удаление; счета ссылаются через `supplyinvoices.contractId`. */
@Injectable()
export class SupplierContractService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplierContract.name) private readonly model: Model<SupplierContractDocument>,
  ) {}

  private date(v: string, label: string): Date {
    const d = parseSheetDate(v);
    if (!d) throw new BadRequestException(`${label} — в формате ДД.ММ.ГГГГ`);
    return d;
  }

  /** Живые счета по договорам: contractId → [{id, no}]. */
  private async invoicesOf(ids: Types.ObjectId[]) {
    const docs = ids.length ? await this.connection.db!.collection('supplyinvoices').find({ contractId: { $in: ids }, deletedAt: null }, { projection: { contractId: 1, no: 1 } }).toArray() : [];
    const map = new Map<string, InvRef[]>();
    for (const d of docs) map.set(String(d.contractId), [...(map.get(String(d.contractId)) ?? []), { id: String(d._id), no: (d.no as string) ?? null }]);
    return map;
  }

  private present(d: Lean, invs?: InvRef[]) {
    return { ...d, id: String(d._id), supplierId: String(d.supplierId), invoicesCount: invs?.length ?? 0 };
  }

  async list(q: Record<string, string | undefined>) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const f: Lean = { deletedAt: null };
    if (q.supplierId) f.supplierId = oid(q.supplierId, 'поставщика');
    if (q.status) {
      if (!['active', 'closed'].includes(q.status)) throw new BadRequestException('Статус договора: active или closed');
      f.status = q.status;
    }
    if (q.q?.trim()) { const re = new RegExp(escapeRe(q.q.trim()), 'i'); f.$or = [{ no: re }, { subject: re }, { supplierName: re }]; }
    const [rows, total] = await Promise.all([
      this.model.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec() as Promise<Lean[]>,
      this.model.countDocuments(f).exec(),
    ]);
    const invs = await this.invoicesOf(rows.map((r) => r._id as Types.ObjectId));
    return { items: rows.map((r) => this.present(r, invs.get(String(r._id)))), total, page, limit };
  }

  private async load(id: string): Promise<Lean> {
    const d = await this.model.findOne({ _id: oid(id, 'договора'), deletedAt: null }).lean().exec();
    if (!d) throw new NotFoundException('Договор не найден');
    return d as Lean;
  }

  async get(id: string) {
    const d = await this.load(id);
    const invs = (await this.invoicesOf([d._id as Types.ObjectId])).get(String(d._id)) ?? [];
    return { ...this.present(d, invs), invoices: invs };
  }

  async create(dto: CreateSupplierContractDto, userId?: string) {
    const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.supplierId, 'поставщика'), deletedAt: null });
    if (!org) throw new BadRequestException('Поставщик не найден среди организаций');
    const no = dto.no.trim();
    if (!no) throw new BadRequestException('Укажите № договора');
    const doc = {
      supplierId: org._id, supplierName: String(org.shortName || org.name || ''), no, date: this.date(dto.date, 'Дата договора'),
      subject: dto.subject?.trim() || undefined, validTo: dto.validTo ? this.date(dto.validTo, 'Срок договора') : undefined, amount: dto.amount,
      fileIds: (dto.fileIds ?? []).map((i) => oid(i, 'файла')), status: dto.status ?? 'active',
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    };
    if (await this.model.exists({ supplierId: org._id, no, deletedAt: null })) throw new ConflictException(dupText(no));
    try {
      const created = await this.model.create(doc);
      return await this.get(String(created._id));
    } catch (e) {
      if (isDup(e)) throw new ConflictException(dupText(no));
      throw e;
    }
  }

  async update(id: string, dto: PatchSupplierContractDto) {
    const d = await this.load(id);
    const $set: Lean = {}; const $unset: Lean = {};
    if (dto.no !== undefined) { const no = dto.no.trim(); if (!no) throw new BadRequestException('Укажите № договора'); $set.no = no; }
    if (dto.date !== undefined) $set.date = this.date(dto.date, 'Дата договора');
    if (dto.subject !== undefined) { if (dto.subject.trim()) $set.subject = dto.subject.trim(); else $unset.subject = ''; }
    if (dto.validTo !== undefined) { if (dto.validTo) $set.validTo = this.date(dto.validTo, 'Срок договора'); else $unset.validTo = ''; }
    if (dto.amount !== undefined) $set.amount = dto.amount;
    if (dto.fileIds !== undefined) $set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.status !== undefined) $set.status = dto.status;
    if ($set.no && $set.no !== d.no && await this.model.exists({ supplierId: d.supplierId, no: $set.no, deletedAt: null, _id: { $ne: d._id } })) {
      throw new ConflictException(dupText(String($set.no)));
    }
    try {
      await this.model.updateOne({ _id: d._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }).exec();
    } catch (e) {
      if (isDup(e)) throw new ConflictException(dupText(String($set.no)));
      throw e;
    }
    return this.get(id);
  }

  /** Удалить (мягко); пока к договору привязаны живые счета — 409 с их номерами. */
  async remove(id: string) {
    const d = await this.load(id);
    const invs = (await this.invoicesOf([d._id as Types.ObjectId])).get(String(d._id)) ?? [];
    if (invs.length) throw new ConflictException(`К договору привязано ${invs.length} ${plural(invs.length)} (№ ${invs.map((i) => i.no || 'без номера').join(', ')}). Сначала отвяжите их`);
    await this.model.updateOne({ _id: d._id }, { $set: { deletedAt: new Date() } }).exec();
    return { id, deleted: true };
  }
}
