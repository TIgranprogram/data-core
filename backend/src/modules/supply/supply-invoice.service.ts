import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { oid } from '../../common/list-query';
import { PatchInvoiceDto } from './dto-invoice';
import { ISSUED_GATE, ORDERED_GATE, missing, splitAmount } from './supply-invoice-rules';
import { SupplyInvoice, SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';
import { SupplyService } from './supply.service';

type Lean = Record<string, unknown>;

/**
 * Счета поставщиков (`supplyinvoices`). Строки счёта — заявки с `invoiceId`; поля счёта в заявках
 * (invoiceNo, invoiceDate, priceHint, companyId, paid, paidAt) — копия, пишется здесь, в одной транзакции со счётом.
 * Ворота — supply-invoice-rules.ts. Старый PATCH /supply/requests не затронут.
 */
@Injectable()
export class SupplyInvoiceService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyInvoice.name) private readonly model: Model<SupplyInvoiceDocument>,
    @InjectModel(SupplyRequest.name) private readonly requests: Model<SupplyRequestDocument>,
    private readonly supply: SupplyService,
  ) {}

  private async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally { await session.endSession(); }
  }

  private async orgNames(ids: unknown[]) {
    const list = ids.filter(Boolean).map((i) => new Types.ObjectId(String(i)));
    const docs = list.length ? await this.connection.db!.collection('organizations').find({ _id: { $in: list } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), String(d.shortName || d.name)]));
  }

  private async load(id: string): Promise<Lean> {
    const inv = await this.model.findOne({ _id: oid(id, 'счёта'), deletedAt: null }).lean().exec();
    if (!inv) throw new NotFoundException('Счёт не найден');
    return inv as Lean;
  }

  /** Счёт + его заявки (в виде для клиента). */
  async get(id: string) {
    const inv = await this.load(id);
    const [items, names] = await Promise.all([this.supply.byInvoice(inv._id as Types.ObjectId), this.orgNames([inv.payerCompanyId])]);
    return { ...inv, id: String(inv._id), payerName: inv.payerCompanyId ? names.get(String(inv.payerCompanyId)) ?? null : null, requests: items };
  }

  /** Заказать группой: заявки делятся по поставщику, на каждого — черновик счёта; заявки → «заказано». */
  async create(requestIds: string[], userId?: string) {
    const ids = [...new Set(requestIds)].map((i) => oid(i, 'заявки'));
    const docs = await this.requests.find({ _id: { $in: ids }, deletedAt: null }).lean().exec() as Lean[];
    if (docs.length !== ids.length) throw new NotFoundException('Часть заявок не найдена — обновите список');
    const names = await this.orgNames(docs.map((d) => d.supplierId));
    for (const d of docs) {
      const label = `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
      if (d.invoiceId) throw new BadRequestException(`${label} уже входит в счёт`);
      if (!['requested', 'in_progress'].includes(String(d.status ?? 'requested'))) throw new BadRequestException(`${label}: заказать можно только заявку «В заказ» или «В работе»`);
      const lack = missing(ORDERED_GATE, d);
      if (lack.length) throw new BadRequestException(`${label}: не заполнено — ${lack.join(', ')}`);
    }
    const groups = new Map<string, Lean[]>();
    for (const d of docs) groups.set(String(d.supplierId), [...(groups.get(String(d.supplierId)) ?? []), d]);
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const made = await this.tx(async (session) => {
      const out: string[] = [];
      for (const [sup, list] of groups) {
        const [inv] = await this.model.create([{ supplierId: new Types.ObjectId(sup), supplierName: names.get(sup), status: 'draft', fileIds: [], createdBy }], { session });
        const res = await this.requests.updateMany(
          { _id: { $in: list.map((d) => d._id) }, deletedAt: null, invoiceId: { $exists: false } },
          { $set: { invoiceId: inv._id, status: 'ordered', paid: false, editedInApp: true } }, { session }).exec();
        if (res.modifiedCount !== list.length) throw new BadRequestException('Заявки изменились, пока вы выбирали — обновите список и повторите');
        out.push(String(inv._id));
      }
      return out;
    });
    return { items: await Promise.all(made.map((i) => this.get(i))) };
  }

  /** Правка счёта; «выставлен» — только при №, дате и сумме. Копирует поля в заявки, сумму делит по строкам. */
  async update(id: string, dto: PatchInvoiceDto) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт оплачен — править его нельзя');
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const set: Lean = {};
    if (dto.no !== undefined) set.no = dto.no.trim() || undefined;
    if (dto.date !== undefined) {
      const d = parseSheetDate(dto.date);
      if (dto.date && !d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      set.date = d;
    }
    if (dto.amount !== undefined) set.amount = dto.amount;
    if (dto.fileIds !== undefined) set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.payerCompanyId !== undefined) {
      if (dto.payerCompanyId) {
        const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.payerCompanyId, 'плательщика'), deletedAt: null });
        if (!org) throw new BadRequestException('Плательщик не найден среди организаций');
        set.payerCompanyId = org._id;
      } else set.payerCompanyId = undefined;
    }
    const next = { ...inv, ...set };
    if (dto.issue) {
      const lack = missing(ISSUED_GATE, next);
      if (lack.length) throw new BadRequestException(`Счёт нельзя отметить выставленным — не заполнено: ${lack.join(', ')}`);
      set.status = 'issued';
    }
    const status = (set.status ?? inv.status) as string;
    await this.tx(async (session) => {
      const $set: Lean = {}; const $unset: Lean = {};
      for (const [k, v] of Object.entries(set)) (v === undefined ? $unset : $set)[k] = v === undefined ? '' : v;
      await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }, { session }).exec();
      if (status === 'issued') await this.copyToRequests({ ...next, status }, session);
    });
    return this.get(id);
  }

  /** Копия полей счёта в заявки: № и дата, плательщик, сумма — пропорционально lineTotal (иначе priceHint), остаток копеек — последней. */
  private async copyToRequests(inv: Lean, session: ClientSession) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null }).sort({ num: 1, _id: 1 }).session(session).lean().exec() as Lean[];
    const shares = splitAmount(Number(inv.amount) || 0, lines.map((l) => Number(l.lineTotal ?? l.priceHint) || 0));
    const common = { invoiceNo: inv.no, invoiceDate: inv.date, editedInApp: true, ...(inv.payerCompanyId ? { companyId: inv.payerCompanyId } : {}) };
    for (let i = 0; i < lines.length; i++) {
      await this.requests.updateOne({ _id: lines[i]._id }, { $set: { ...common, priceHint: shares[i] } }, { session }).exec();
    }
  }

  /** Оплата всего счёта: нужен «выставлен» и плательщик. */
  async pay(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт уже оплачен');
    if (inv.status !== 'issued') throw new BadRequestException('Сначала отметьте счёт выставленным: нужны №, дата и сумма');
    if (!inv.payerCompanyId) throw new BadRequestException('Укажите, какая компания платит (плательщик)');
    const now = new Date();
    await this.tx(async (session) => {
      await this.model.updateOne({ _id: inv._id }, { $set: { status: 'paid', paidAt: now } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } },
        { $set: { paid: true, paidAt: now, status: 'ordered', editedInApp: true } }, { session }).exec();
    });
    return this.get(id);
  }

  /** Удалить счёт (мягко): оплаченный нельзя; заявки отвязываются и возвращаются в «В заказ». */
  async remove(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт оплачен — удалить нельзя');
    await this.tx(async (session) => {
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'ordered', paid: { $ne: true } }, { $set: { status: 'requested' } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id }, { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { editedInApp: true } }, { session }).setOptions({ includeSoftDeleted: true }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { deletedAt: new Date() } }, { session }).exec();
    });
    return { id, deleted: true };
  }
}
