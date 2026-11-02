import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { StockScope } from '../../common/stock-scope';
import { docScopeMatch } from '../../common/supply-scope';
import { parseSheetDate } from '../../common/date-parse';
import { escapeRe, oid } from '../../common/list-query';
import { NotificationsService } from '../notifications/notifications.service';
import { MaterialPriceService } from '../material/material-price.service';
import type { PriceSource } from '../material/material-price.schema';
import { PatchInvoiceDto } from './dto-invoice';
import { ISSUED_GATE, ORDERED_GATE, missing, normInvoiceNo } from './supply-invoice-rules';
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
    private readonly prices: MaterialPriceService,
    private readonly notices: NotificationsService,
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

  /**
   * Единая финансовая блокировка счёта. Оплачен или по нему уже есть приёмка на склад —
   * менять строки, цены, количество и сумму нельзя; остаются только метаданные (файлы, договор, №, дата).
   * Исправления — отдельной операцией корректировки/сторно.
   */
  private async lockReason(inv: Lean): Promise<string | null> {
    if (inv.status === 'paid') return 'Счёт оплачен — финансовые поля заблокированы';
    if (typeof this.requests.countDocuments === 'function') {
      const received = await this.requests.countDocuments({ invoiceId: inv._id, deletedAt: null, status: 'received' }).exec();
      if (Number(received) > 0) return 'По счёту уже есть приёмка на склад — финансовые поля заблокированы';
    }
    return null;
  }

  /** Сумма строк счёта: `priceHint` — сумма строки (не цена за единицу), отменённые строки не считаем. */
  private async linesSum(inv: Lean): Promise<number> {
    const lines = this.requests.find ? await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[] : [];
    return Math.round(lines.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
  }

  /** Инвариант счёта: amount = сумма priceHint всех строк. Пересчёт — только в транзакции. */
  private async recalcAmount(inv: Lean, session: ClientSession): Promise<number> {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).session(session).lean().exec() as Lean[];
    const amount = Math.round(lines.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    if (Number(inv.amount ?? -1) !== amount) await this.model.updateOne({ _id: inv._id }, { $set: { amount }, $inc: { version: 1 } }, { session }).exec();
    return amount;
  }

  /** Строки счёта (для явного объединения): без удалённых и отменённых. */
  private async linesOf(inv: Lean, session?: ClientSession): Promise<Lean[]> {
    const q = this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } });
    return (session ? await q.session(session).lean().exec() : await q.lean().exec()) as Lean[];
  }

  /** Договоры поставщиков по id: contractId → { no, date, status } (удалённые не показываем). */
  private async contractInfo(ids: unknown[]) {
    const list = [...new Set(ids.filter(Boolean).map(String))].map((i) => new Types.ObjectId(i));
    const docs = list.length ? await this.connection.db!.collection('suppliercontracts').find({ _id: { $in: list }, deletedAt: null }, { projection: { no: 1, date: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), { contractNo: (d.no as string) ?? null, contractDate: (d.date as Date) ?? null }]));
  }

  /** Договор для счёта: существует, не удалён, того же поставщика; закрытый — только если уже выбран. */
  private async checkContract(contractId: string, supplierId: unknown, current: unknown): Promise<Types.ObjectId> {
    const c = await this.connection.db!.collection('suppliercontracts').findOne({ _id: oid(contractId, 'договора'), deletedAt: null });
    if (!c) throw new BadRequestException('Договор не найден');
    if (!supplierId || String(c.supplierId) !== String(supplierId)) throw new BadRequestException('Договор другого поставщика');
    if (c.status === 'closed' && String(current ?? '') !== String(c._id)) throw new BadRequestException('Договор закрыт — выберите действующий');
    return c._id;
  }

  /** Номера заказов/договоров по заявкам: salesOrderId → { orderNo, productionNo, contractNo }. */
  private async orderInfo(reqs: Lean[]) {
    const ids = [...new Set(reqs.map((r) => r.salesOrderId).filter(Boolean).map(String))].map((i) => new Types.ObjectId(i));
    const docs = ids.length ? await this.connection.db!.collection('salesorders').find({ _id: { $in: ids } }, { projection: { orderNo: 1, productionNo: 1, contractNo: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), { orderNo: (d.orderNo as string) ?? null, productionNo: (d.productionNo as string) ?? null, contractNo: (d.contractNo as string) ?? null }]));
  }

  /** Список счетов: статус (через запятую), поставщик, поиск по № / поставщику, период по дате счёта; sum — по всем найденным. */
  /** Склады (WZ): какие из заявок видны в доступе (null — все). */
  private async visibleRequests(ids: Types.ObjectId[], scope: StockScope | null): Promise<Set<string> | null> {
    if (!scope) return null;
    if (!ids.length) return new Set();
    const sc = await docScopeMatch(this.connection, scope);
    return new Set((await this.requests.distinct('_id', { _id: { $in: ids }, ...sc }).exec()).map(String));
  }

  /** Склады (WZ): менять счёт можно, только если все его заявки из своего склада, иначе 403. */
  async assertWhole(id: string, scope: StockScope | null): Promise<void> {
    if (!scope) return;
    const ids = await this.requests.distinct('_id', { invoiceId: oid(id, 'счёта'), deletedAt: null }).exec() as Types.ObjectId[];
    const vis = await this.visibleRequests(ids, scope);
    if (vis && ids.some((x) => !vis.has(String(x)))) throw new ForbiddenException('В этом счёте есть заявки не из вашего склада');
  }

  /** Склады (WZ): заявки для нового счёта — только из своего склада. */
  async assertRequests(requestIds: string[], scope: StockScope | null): Promise<void> {
    if (!scope) return;
    const ids = [...new Set(requestIds)].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const vis = await this.visibleRequests(ids, scope);
    if (vis && ids.some((x) => !vis.has(String(x)))) throw new ForbiddenException('Среди заявок есть не из вашего склада');
  }

  /** Склады (WZ): итог по фильтру считается по видимым строкам (смешанный счёт — только своя часть), как amount в списке. */
  private async scopedSum(f: Lean, scope: StockScope): Promise<number> {
    const invs = await this.model.find(f).select('amount').lean().exec() as Lean[];
    if (!invs.length) return 0;
    const all = await this.requests.find({ invoiceId: { $in: invs.map((i) => i._id) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[];
    const vis = await this.visibleRequests(all.map((x) => x._id as Types.ObjectId), scope);
    const by = new Map<string, { all: number; mine: number; sum: number }>();
    for (const x of all) {
      const k = String(x.invoiceId); const e = by.get(k) ?? { all: 0, mine: 0, sum: 0 };
      e.all++; if (!vis || vis.has(String(x._id))) { e.mine++; e.sum += Number(x.priceHint) || 0; }
      by.set(k, e);
    }
    return invs.reduce((t, i) => { const e = by.get(String(i._id)); return t + (e && e.mine < e.all ? e.sum : Number(i.amount) || 0); }, 0);
  }

  async list(q: Record<string, string | undefined>, scope: StockScope | null = null) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const f: Lean = { deletedAt: null };
    const st = (q.status ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (st.length) f.status = { $in: st };
    if (q.supplierId) f.supplierId = oid(q.supplierId, 'поставщика');
    if (q.contract) {
      if (!['none', 'has'].includes(q.contract)) throw new BadRequestException('Договор: none (без договора) или has (с договором)');
      f.contractId = q.contract === 'none' ? null : { $ne: null };
    }
    if (q.q?.trim()) { const re = new RegExp(escapeRe(q.q.trim()), 'i'); f.$or = [{ no: re }, { supplierName: re }]; }
    const range: Lean = {};
    if (q.from) { const d = parseSheetDate(q.from); if (!d) throw new BadRequestException('Дата «с» — в формате ГГГГ-ММ-ДД'); range.$gte = d; }
    if (q.to) { const d = parseSheetDate(q.to); if (!d) throw new BadRequestException('Дата «по» — в формате ГГГГ-ММ-ДД'); range.$lt = new Date(d.getTime() + 86400000); }
    if (Object.keys(range).length) f.date = range;
    if (scope) { // склады (WZ): счета, где есть хотя бы одна своя заявка
      f._id = { $in: await this.requests.distinct('invoiceId', { invoiceId: { $ne: null }, deletedAt: null, ...(await docScopeMatch(this.connection, scope)) }).exec() };
    }
    const [rows, total, agg] = await Promise.all([
      this.model.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec() as Promise<Lean[]>,
      this.model.countDocuments(f).exec(),
      this.model.aggregate([{ $match: f }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).exec(),
    ]);
    const allReqs = rows.length ? await this.requests.find({ invoiceId: { $in: rows.map((r) => r._id) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[] : [];
    const vis = await this.visibleRequests(allReqs.map((x) => x._id as Types.ObjectId), scope);
    const reqs = vis ? allReqs.filter((x) => vis.has(String(x._id))) : allReqs; // смешанный счёт: только свои строки, сумма по ним
    const [orders, names, contracts] = await Promise.all([this.orderInfo(reqs), this.orgNames(rows.map((r) => r.payerCompanyId)), this.contractInfo(rows.map((r) => r.contractId))]);
    const items = rows.map((r) => {
      const mine = reqs.filter((x) => String(x.invoiceId) === String(r._id));
      const partial = allReqs.some((x) => String(x.invoiceId) === String(r._id)) && mine.length < allReqs.filter((x) => String(x.invoiceId) === String(r._id)).length;
      const nos = [...new Set(mine.map((x) => orders.get(String(x.salesOrderId))).filter(Boolean).map((o) => o!.productionNo || o!.orderNo).filter(Boolean))] as string[];
      return { id: String(r._id), no: r.no ?? null, date: r.date ?? null, partial, amount: partial ? mine.reduce((s, x) => s + (Number(x.priceHint) || 0), 0) : r.amount ?? 0, status: r.status, paidAt: r.paidAt ?? null,
        supplierId: r.supplierId ? String(r.supplierId) : null, supplierName: r.supplierName ?? null,
        payerName: r.payerCompanyId ? names.get(String(r.payerCompanyId)) ?? null : null,
        contractId: r.contractId ? String(r.contractId) : null, contractNo: contracts.get(String(r.contractId))?.contractNo ?? null, contractDate: contracts.get(String(r.contractId))?.contractDate ?? null, requestsCount: mine.length, orders: nos };
    });
    const sum = scope ? await this.scopedSum(f, scope) : (agg[0]?.sum as number) ?? 0;
    return { items, total, page, limit, sum };
  }

  /** Счёт + его заявки (с № заказа/договора), файлы с адресами, цепочка заказы → договоры. */
  async get(id: string, scope: StockScope | null = null) {
    const inv = await this.load(id);
    const [all, names, contracts] = await Promise.all([this.supply.byInvoice(inv._id as Types.ObjectId), this.orgNames([inv.payerCompanyId]), this.contractInfo([inv.contractId])]);
    const vis = await this.visibleRequests((all as Lean[]).map((x) => new Types.ObjectId(String(x._id ?? x.id))), scope);
    const items = vis ? (all as Lean[]).filter((x) => vis.has(String(x._id ?? x.id))) : all;
    if (vis && !items.length) throw new ForbiddenException('Этот счёт не из вашего склада');
    const partial = items.length < all.length;
    const contract = contracts.get(String(inv.contractId));
    const orders = await this.orderInfo(items as Lean[]);
    const requests = (items as Lean[]).map((r) => {
      const o = r.salesOrderId ? orders.get(String(r.salesOrderId)) : undefined;
      return { ...r, orderNo: o?.orderNo ?? null, productionNo: o?.productionNo ?? null, contractNo: o?.contractNo ?? null, hasOrder: Boolean(o) };
    });
    const chain = new Map<string, { productionNo: string | null; contracts: string[] }>();
    for (const r of requests) {
      if (!r.hasOrder) continue;
      const key = r.productionNo ?? '';
      const e = chain.get(key) ?? { productionNo: r.productionNo, contracts: [] };
      const c = r.contractNo ?? r.orderNo;
      if (c && !e.contracts.includes(c)) e.contracts.push(c);
      chain.set(key, e);
    }
    const fids = (inv.fileIds as Types.ObjectId[] | undefined) ?? [];
    const photos = fids.length ? await this.connection.db!.collection('photos').find({ _id: { $in: fids } }, { projection: { storageUrl: 1, originalName: 1, originalFilename: 1, mimeType: 1, name: 1 } }).toArray() : [];
    const files = fids.map((f) => photos.find((p) => String(p._id) === String(f))).filter(Boolean).map((p) => ({ id: String(p!._id), url: String(p!.storageUrl), name: String(p!.originalFilename ?? p!.originalName ?? p!.name ?? 'Файл счёта'), mime: (p!.mimeType as string | undefined) ?? null }));
    return { ...inv, partial, ...(partial ? { amount: (items as Lean[]).reduce((s, x) => s + (Number(x.priceHint) || 0), 0) } : {}), id: String(inv._id), payerName: inv.payerCompanyId ? names.get(String(inv.payerCompanyId)) ?? null : null, contractNo: contract?.contractNo ?? null, contractDate: contract?.contractDate ?? null, requests, files, orders: [...chain.values()] };
  }

  /** Принять счёт на склад: каждая неполученная заявка — через SupplyService.receive (приход на склад по умолчанию, повтор безопасен по clientUid). */
  async receive(id: string, requestIds: string[] | undefined, userId?: string) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).sort({ num: 1, _id: 1 }).lean().exec() as Lean[];
    const label = (d: Lean) => `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
    let todo = lines.filter((d) => d.status !== 'received');
    if (requestIds?.length) {
      const want = [...new Set(requestIds)];
      for (const w of want) {
        const d = lines.find((x) => String(x._id) === w);
        if (!d) throw new BadRequestException('Заявка не входит в этот счёт');
        if (d.status === 'received') throw new ConflictException(`${label(d)} уже принята на склад`);
      }
      todo = lines.filter((d) => want.includes(String(d._id)));
    }
    if (!todo.length) throw new ConflictException('Все позиции этого счёта уже приняты на склад');
    for (const d of todo) {
      // после отмены прихода ключ меняется (число отменённых), иначе новый приём принят бы за повтор старого
      const n = await this.connection.db!.collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${String(d._id)}`, cancelledAt: { $ne: null } });
      await this.supply.receive(String(d._id), { clientUid: `inv-${id}-${String(d._id)}${n ? '-' + n : ''}` }, userId);
    }
    return { ...(await this.get(id)), receivedCount: todo.length };
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
        await this.recalcAmount({ _id: inv._id } as Lean, session);
        out.push(String(inv._id));
      }
      return out;
    });
    return { items: await Promise.all(made.map((i) => this.get(i))) };
  }

  /** Правка счёта. Финансовые поля (сумма, строки) — только пока нет оплаты/приёмки. */
  async update(id: string, dto: PatchInvoiceDto, actorId?: string) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    if (lock) {
      const financial = Object.entries(dto).filter(([k, v]) => v !== undefined && !['fileIds', 'contractId', 'no', 'date'].includes(k));
      if (financial.length) throw new BadRequestException(`${lock}. Менять можно файлы, договор, номер и дату; исправления сумм — корректировкой/сторно`);
      return this.patchLocked(inv, dto);
    }
    const set: Lean = {};
    if (dto.no !== undefined) set.no = dto.no.trim() || undefined;
    if (dto.date !== undefined) {
      const d = parseSheetDate(dto.date);
      if (dto.date && !d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      set.date = d;
    }
    if (dto.fileIds !== undefined) set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.payerCompanyId !== undefined) {
      if (dto.payerCompanyId) {
        const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.payerCompanyId, 'плательщика'), deletedAt: null });
        if (!org) throw new BadRequestException('Плательщик не найден среди организаций');
        set.payerCompanyId = org._id;
      } else set.payerCompanyId = undefined;
    }
    if (dto.supplierId !== undefined) {
      const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.supplierId, 'поставщика'), deletedAt: null });
      if (!org) throw new BadRequestException('Поставщик не найден среди организаций');
      set.supplierId = org._id;
      set.supplierName = String(org.shortName || org.name || '');
    }
    const warnings: string[] = [];
    const supplierNow = set.supplierId ?? inv.supplierId;
    if (dto.contractId) set.contractId = await this.checkContract(dto.contractId, supplierNow, inv.contractId);
    else if (dto.contractId === '') set.contractId = undefined;
    else if (set.supplierId && inv.contractId && String(set.supplierId) !== String(inv.supplierId)) {
      set.contractId = undefined;
      warnings.push('Договор снят: он относится к прежнему поставщику. Выберите договор нового поставщика');
    }
    const noNow = 'no' in set ? set.no : inv.no;
    if ((dto.no !== undefined || set.supplierId) && noNow && supplierNow) {
      const key = normInvoiceNo(noNow);
      const same = await this.model.find({ supplierId: supplierNow, deletedAt: null, status: { $ne: 'cancelled' }, _id: { $ne: inv._id } }).lean().exec() as Lean[];
      const dup = same.find((x) => normInvoiceNo(x.no) === key);
      if (dup) {
        // Автоматической склейки нет: дубль номера — конфликт, пользователь решает явно.
        if (dto.duplicateReason?.trim()) {
          // осознанно оставляем отдельный счёт с тем же номером — причина в карточке и в аудите
          set.duplicateOf = dup._id;
          set.duplicateReason = dto.duplicateReason.trim();
        } else {
          throw new ConflictException({
            message: `Счёт № ${String(dup.no)} у этого поставщика уже есть`,
            existingInvoiceId: String(dup._id),
            existingNo: dup.no ?? null,
            existingStatus: dup.status,
            hint: 'Откройте его, добавьте позиции явным объединением (POST /api/supply/invoices/<id>/merge) или сохраните с причиной (duplicateReason)',
          });
        }
      }
    }
    if (dto.amount !== undefined) {
      // amount — производная от строк; ввод общей суммы не «делит» цены заново (это и «слипало» строки)
      const sum = await this.linesSum(inv);
      if (Math.abs(Number(dto.amount) - sum) > 0.009) {
        throw new BadRequestException(`Сумма счёта считается по строкам (сейчас ${sum.toFixed(2)}). Измените цену позиции, а не общую сумму`);
      }
      set.amount = sum;
    }
    const next = { ...inv, ...set };
    if (dto.issue) {
      const sum = await this.linesSum(inv);
      if (!(Number(next.amount) > 0) && sum > 0) { set.amount = sum; next.amount = sum; }
      const lack = missing(ISSUED_GATE, next);
      if (lack.length) throw new BadRequestException(`Счёт нельзя отметить выставленным — не заполнено: ${lack.join(', ')}`);
      if (Math.abs((Number(next.amount) || 0) - sum) > 0.009) throw new BadRequestException('Сумма счёта не совпадает с суммой строк — исправьте цены позиций');
      set.status = 'issued';
      next.status = 'issued';
    }
    const status = (set.status ?? inv.status) as string;
    await this.tx(async (session) => {
      const $set: Lean = {}; const $unset: Lean = {};
      for (const [k, v] of Object.entries(set)) (v === undefined ? $unset : $set)[k] = v === undefined ? '' : v;
      await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}), $inc: { version: 1 } }, { session }).exec();
      if (status === 'issued') {
        // № / дата / плательщик — только метаданные строк; цены не перераспределяются (это и «слипало» строки)
        await this.copyMetaToRequests({ ...next, status }, session, []);
        await this.recordPrices({ ...next, status }, 'invoice_issued', session);
      } else if (set.supplierId) {
        await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null }, { $set: { supplierId: set.supplierId, editedInApp: true } }, { session }).exec();
      }
    });
    if (status === 'issued' && inv.status !== 'issued') {
      const what = [next.no ? `№${next.no}` : '', next.supplierName ? `от ${next.supplierName}` : ''].filter(Boolean).join(' ');
      await this.notices.toRoles(['admin', 'director', 'accountant'], { type: 'invoice_awaiting_payment', text: `Счёт ${what || 'без номера'} выставлен — ждёт оплаты`, href: `#requests?tab=invoices&open=${id}` }, actorId);
    }
    return warnings.length ? { ...(await this.get(id)), warnings } : this.get(id);
  }

  /** Добавить заявки в счёт: только пока нет оплаты/приёмки. Сумма пересчитывается из всех строк, старые цены не трогаем. */
  async addRequests(id: string, requestIds: string[]) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock}. Добавить позиции можно только до оплаты/приёмки`);
    const ids = [...new Set(requestIds)].map((i) => oid(i, 'заявки'));
    const docs = await this.requests.find({ _id: { $in: ids }, deletedAt: null }).lean().exec() as Lean[];
    if (docs.length !== ids.length) throw new NotFoundException('Часть заявок не найдена — обновите список');
    for (const d of docs) {
      const label = `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
      if (d.invoiceId) throw new BadRequestException(`${label} уже входит в счёт`);
      const open = ['requested', 'in_progress'].includes(String(d.status ?? 'requested'));
      if (!open && !(d.status === 'ordered' && d.paid)) throw new BadRequestException(`${label}: добавить можно заявку «В заказ», «В работе» или «Оплачено»`);
      if (inv.supplierId && d.supplierId && String(d.supplierId) !== String(inv.supplierId)) throw new BadRequestException(`${label}: другой поставщик, чем у счёта`);
      if (open) {
        const lack = missing(ORDERED_GATE, { ...d, supplierId: d.supplierId ?? inv.supplierId });
        if (lack.length) throw new BadRequestException(`${label}: не заполнено — ${lack.join(', ')}`);
      }
    }
    const amount = await this.tx(async (session) => {
      await this.requests.updateMany({ _id: { $in: ids }, deletedAt: null, invoiceId: null },
        { $set: { invoiceId: inv._id, status: 'ordered', editedInApp: true, ...(inv.supplierId ? { supplierId: inv.supplierId } : {}) } }, { session }).exec();
      const fresh = { ...inv } as Lean;
      const sum = await this.recalcAmount(fresh, session);
      if (inv.status === 'issued') await this.copyMetaToRequests({ ...inv, amount: sum }, session, ids);
      return sum;
    });
    return { ...(await this.get(id)), amount };
  }

  /** Предпросмотр явного объединения: ничего не меняет, показывает строки, дубли и итоговые суммы. */
  async mergePreview(id: string, targetId: string) {
    const [src, dst] = await Promise.all([this.load(id), this.load(targetId)]);
    this.assertMergeable(src, dst);
    const [a, b] = await Promise.all([this.linesOf(src), this.linesOf(dst)]);
    const sum = (ls: Lean[]) => Math.round(ls.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    const dup = a.filter((l) => b.some((d) => this.sameLine(d, l)));
    const dupSum = Math.round(dup.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    return {
      source: { id: String(src._id), no: src.no ?? null, date: src.date ?? null, status: src.status, lines: a.length, amount: sum(a) },
      target: { id: String(dst._id), no: dst.no ?? null, date: dst.date ?? null, status: dst.status, lines: b.length, amount: sum(b) },
      duplicates: dup.length,
      strategies: ['append', 'mergeSameRequest', 'replaceLines'],
      resultAmount: {
        append: Math.round((sum(a) + sum(b)) * 100) / 100,
        mergeSameRequest: Math.round((sum(a) - dupSum + sum(b)) * 100) / 100,
        replaceLines: sum(a),
      },
    };
  }

  /** Явное объединение двух счетов. Стратегия выбирается пользователем; пишется в журнал счёта и в аудит. */
  async merge(id: string, targetId: string, strategy: 'append' | 'mergeSameRequest' | 'replaceLines', actorId?: string) {
    if (!['append', 'mergeSameRequest', 'replaceLines'].includes(strategy)) throw new BadRequestException('Стратегия объединения: append, mergeSameRequest или replaceLines');
    const [src, dst] = await Promise.all([this.load(id), this.load(targetId)]);
    this.assertMergeable(src, dst);
    const lockSrc = await this.lockReason(src);
    if (lockSrc) throw new BadRequestException(`${lockSrc} — этот счёт нельзя объединить`);
    const lockDst = await this.lockReason(dst);
    if (lockDst) throw new BadRequestException(`${lockDst} — в этот счёт нельзя объединить`);
    const by = actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : undefined;
    const out = await this.tx(async (session) => {
      const a = await this.linesOf(src, session);
      const b = strategy === 'mergeSameRequest' || strategy === 'replaceLines' ? await this.linesOf(dst, session) : [];
      let moved = 0, skipped = 0, replaced = 0;
      if (strategy === 'replaceLines') {
        for (const d of b) {
          await this.requests.updateOne({ _id: d._id },
            { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { ...(d.status === 'ordered' && d.paid !== true ? { status: 'requested' } : {}), editedInApp: true } }, { session }).exec();
          replaced++;
        }
      }
      for (const l of a) {
        if (strategy === 'mergeSameRequest' && b.some((d) => this.sameLine(d, l))) {
          await this.requests.updateOne({ _id: l._id }, { $set: { deletedAt: new Date(), status: 'cancelled', editedInApp: true } }, { session }).exec();
          skipped++;
          continue;
        }
        await this.requests.updateOne({ _id: l._id }, { $set: { invoiceId: dst._id, ...(dst.supplierId ? { supplierId: dst.supplierId } : {}), editedInApp: true } }, { session }).exec();
        moved++;
      }
      const files = new Map<string, Types.ObjectId>();
      for (const f of [...((dst.fileIds as Types.ObjectId[]) ?? []), ...((src.fileIds as Types.ObjectId[]) ?? [])]) files.set(String(f), f);
      const patch: Lean = { fileIds: [...files.values()] };
      for (const k of ['contractId', 'payerCompanyId', 'date', 'no']) if (!dst[k] && src[k]) patch[k] = src[k];
      await this.model.updateOne({ _id: dst._id },
        { $set: patch, $push: { mergeLog: { at: new Date(), ...(by ? { by } : {}), fromId: src._id, strategy, moved, skipped, replaced } } }, { session }).exec();
      const amount = await this.recalcAmount({ ...dst, ...patch }, session);
      await this.model.updateOne({ _id: src._id }, { $set: { deletedAt: new Date(), mergedInto: dst._id, status: 'cancelled' } }, { session }).exec();
      return { moved, skipped, replaced, amount };
    });
    return { targetInvoiceId: String(dst._id), ...out, invoice: await this.get(String(dst._id)) };
  }

  private assertMergeable(src: Lean, dst: Lean) {
    if (String(src._id) === String(dst._id)) throw new BadRequestException('Нельзя объединить счёт с самим собой');
    if (src.status === 'cancelled' || dst.status === 'cancelled') throw new BadRequestException('Отменённый счёт не объединяется');
    if (src.supplierId && dst.supplierId && String(src.supplierId) !== String(dst.supplierId)) throw new BadRequestException('Счета разных поставщиков не объединяются');
  }

  /** Одна и та же позиция: материал (или наименование) + количество + сумма строки. */
  private sameLine(a: Lean, b: Lean): boolean {
    const t = (x: Lean) => String(x.title ?? x.materialName ?? '');
    if (a.materialId && b.materialId) return String(a.materialId) === String(b.materialId) && Number(a.qty) === Number(b.qty) && Number(a.priceHint) === Number(b.priceHint);
    return t(a) === t(b) && Number(a.qty) === Number(b.qty) && Number(a.priceHint) === Number(b.priceHint);
  }

  /** Оплаченный/принятый счёт: только метаданные (файлы, договор, №, дата), без пересчёта строк и суммы. */
  private async patchLocked(inv: Lean, dto: PatchInvoiceDto) {
    const $set: Lean = {}; const $unset: Lean = {};
    if (dto.fileIds !== undefined) $set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.contractId) $set.contractId = await this.checkContract(dto.contractId, inv.supplierId, inv.contractId);
    else if (dto.contractId === '') $unset.contractId = '';
    if (dto.no !== undefined) { if (dto.no.trim()) $set.no = dto.no.trim(); else $unset.no = ''; }
    if (dto.date) {
      const d = parseSheetDate(dto.date);
      if (!d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      $set.date = d;
    }
    if (Object.keys($set).length || Object.keys($unset).length) {
      await this.tx(async (session) => {
        await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}), $inc: { version: 1 } }, { session }).exec();
        // № / дата / плательщик — метаданные строк, цены и количество не трогаем
        if (['no', 'date'].some((k) => k in $set || k in $unset)) await this.copyMetaToRequests({ ...inv, ...$set }, session, []);
      });
    }
    return this.get(String(inv._id));
  }

  /** Копия только метаданных счёта (№, дата, плательщик, поставщик) в заявки — без пересчёта суммы по строкам. */
  private async copyMetaToRequests(inv: Lean, session: ClientSession, _newIds: Types.ObjectId[]) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null }).sort({ num: 1, _id: 1 }).session(session).lean().exec() as Lean[];
    const common = { invoiceNo: inv.no, invoiceDate: inv.date, editedInApp: true, ...(inv.supplierId ? { supplierId: inv.supplierId } : {}), ...(inv.payerCompanyId ? { companyId: inv.payerCompanyId } : {}) };
    for (const l of lines) {
      // цены строк — собственность строки: здесь не пишем priceHint
      await this.requests.updateOne({ _id: l._id }, { $set: { ...common } }, { session }).exec();
    }
  }

  /** Строка истории цен на каждую заявку счёта с materialId: сумма строки (после деления) / количество. */
  private async recordPrices(inv: Lean, source: PriceSource, session: ClientSession, only?: Types.ObjectId[]) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' }, materialId: { $exists: true, $ne: null }, ...(only ? { _id: { $in: only } } : {}) }).session(session).lean().exec() as Lean[];
    for (const l of lines) {
      await this.prices.record({
        materialId: l.materialId as Types.ObjectId, supplierId: inv.supplierId as Types.ObjectId | undefined, supplierName: inv.supplierName as string | undefined,
        lineTotalWithVat: Number(l.priceHint) || 0, qty: Number(l.qty) || 0, unit: l.unit as string | undefined, vatRate: inv.vatRate as number | undefined,
        date: (inv.date as Date | undefined) ?? new Date(), source, invoiceId: inv._id as Types.ObjectId, requestId: l._id as Types.ObjectId,
        salesOrderId: l.salesOrderId as Types.ObjectId | undefined, createdBy: inv.createdBy as Types.ObjectId | undefined,
      }, session);
    }
  }

  /** Правка цены одной строки счёта. Принимает цену за единицу или сумму строки; amount пересчитывается из строк. */
  async updateLine(invoiceId: string, lineId: string, dto: { unitPrice?: number; lineAmount?: number; version?: number }) {
    const inv = await this.load(invoiceId);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock}. Исправления — корректировкой/сторно`);
    const line = await this.requests.findOne({ _id: oid(lineId, 'заявки'), invoiceId: inv._id, deletedAt: null }).exec() as Lean | null;
    if (!line) throw new NotFoundException('Строка не найдена в счёте');
    const qty = Number(line.qty) || 0;
    if (!(qty > 0)) throw new BadRequestException('У строки не указано количество — сначала заполните количество');
    let priceHint: number;
    if (dto.lineAmount !== undefined) {
      if (!(Number(dto.lineAmount) >= 0)) throw new BadRequestException('Сумма строки не может быть отрицательной');
      priceHint = Math.round(Number(dto.lineAmount) * 100) / 100;
    } else if (dto.unitPrice !== undefined) {
      if (!(Number(dto.unitPrice) >= 0)) throw new BadRequestException('Цена за единицу не может быть отрицательной');
      priceHint = Math.round(Number(dto.unitPrice) * qty * 100) / 100;
    } else throw new BadRequestException('Укажите цену за единицу (unitPrice) или сумму строки (lineAmount)');
    const amount = await this.tx(async (session) => {
      if (dto.version !== undefined) {
        const fresh = await this.model.findOne({ _id: inv._id }, { version: 1 }).session(session).lean().exec() as Lean | null;
        if (Number(fresh?.version ?? 0) !== Number(dto.version)) throw new ConflictException('Счёт изменился, пока вы правили цену — обновите и повторите');
      }
      await this.requests.updateOne({ _id: line._id }, { $set: { priceHint, editedInApp: true } }, { session }).exec();
      // черновик — ручная цена; выставленный/оплаченный — цена счёта (история по строке, upsert по requestId+source)
      await this.recordPrices({ ...inv, amount: priceHint }, inv.status === 'draft' ? 'manual' : 'invoice_issued', session, [line._id as Types.ObjectId]);
      return this.recalcAmount(inv, session);
    });
    const invoice = await this.get(invoiceId);
    return { invoice, line: { id: String(lineId), qty, unitPrice: Math.round((priceHint / qty) * 100) / 100, lineAmount: priceHint }, amount };
  }

  /** Убрать строку из счёта, не удаляя заявку: вернуть в «В заказ»/«В работе», пересчитать сумму. */
  async removeLine(invoiceId: string, lineId: string) {
    const inv = await this.load(invoiceId);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock}. Убрать строку можно только до оплаты/приёмки`);
    const line = await this.requests.findOne({ _id: oid(lineId, 'заявки'), invoiceId: inv._id, deletedAt: null }).exec() as Lean | null;
    if (!line) throw new NotFoundException('Строка не найдена в счёте');
    if (line.status === 'received') throw new BadRequestException('Строка уже принята на склад');
    const amount = await this.tx(async (session) => {
      await this.requests.updateOne({ _id: line._id },
        { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { ...(line.status === 'ordered' && line.paid !== true ? { status: 'requested' } : {}), editedInApp: true } }, { session }).exec();
      return this.recalcAmount(inv, session);
    });
    return { invoice: await this.get(invoiceId), removed: String(line._id), amount };
  }

  /** Оплата всего счёта: нужен «выставлен», плательщик и amount = сумма строк. */
  async pay(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт уже оплачен');
    if (inv.status !== 'issued') throw new BadRequestException('Сначала отметьте счёт выставленным: нужны №, дата и сумма');
    if (!inv.payerCompanyId) throw new BadRequestException('Укажите, какая компания платит (плательщик)');
    const sum = await this.linesSum(inv);
    if (Math.abs((Number(inv.amount) || 0) - sum) > 0.009) throw new BadRequestException('Сумма счёта не совпадает с суммой строк — исправьте цены позиций');
    const now = new Date();
    await this.tx(async (session) => {
      await this.model.updateOne({ _id: inv._id }, { $set: { status: 'paid', paidAt: now }, $inc: { version: 1 } }, { session }).exec();
      // «Получено» оплата не откатывает в «Заказано» — только отметка оплаты (HARDEN-1 п.3)
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $nin: ['cancelled', 'received'] } },
        { $set: { paid: true, paidAt: now, status: 'ordered', editedInApp: true } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'received' },
        { $set: { paid: true, paidAt: now, editedInApp: true } }, { session }).exec();
      await this.recordPrices(inv, 'invoice_paid', session);
    });
    return this.get(id);
  }

  /** Удалить счёт (мягко): оплаченный/принятый нельзя; заявки отвязываются и возвращаются в «В заказ». */
  async remove(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock} — удалить нельзя`);
    await this.tx(async (session) => {
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'ordered', paid: { $ne: true } }, { $set: { status: 'requested' } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id }, { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { editedInApp: true } }, { session }).setOptions({ includeSoftDeleted: true }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { deletedAt: new Date() } }, { session }).exec();
    });
    return { id, deleted: true };
  }
}
