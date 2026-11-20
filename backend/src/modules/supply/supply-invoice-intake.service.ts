import {
  BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { validateSync } from 'class-validator';
import { promises as fs } from 'fs';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { StockScope } from '../../common/stock-scope';
import { assertNewDocInScope } from '../../common/supply-scope';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { IsINN } from '../../common/validators/inn.validator';
import { inspectIntakePdf } from '../photos/photo-intake.storage';
import { PhotoIntakeService } from '../photos/photo-intake.service';
import type { SupplyInvoiceIntakeDto, SupplyInvoiceIntakeReceiptDto, SupplyIntakeVatMode } from './dto-invoice-intake';
import { cents } from './invoice-financials';
import { legacyInvoiceKeyMatches, lockInvoiceIdentity } from './supply-invoice-identity';
import { intakeLineUid, prepareInvoiceIntake, type PreparedInvoiceIntake } from './supply-invoice-intake-values';
import { SUPPLY_INTAKE_INDEXES, SupplyInvoice, type SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyInvoiceService } from './supply-invoice.service';
import { SupplyRequest, type SupplyRequestDocument } from './supply-request.schema';

const RECEIPT_FIELDS = '+intakeUid +intakeBusinessKey +intakeSourceSha256 +intakePayloadHash +intakeLines';
const REQUEST_COUNTER = { entity: 'SupplyRequest', prefix: 'N', year: 0 };
type Invoice = SupplyInvoice & { _id: Types.ObjectId };

class IntakeParty {
  @IsINN()
  inn!: string;
}

@Injectable()
export class SupplyInvoiceIntakeService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyInvoice.name) private readonly invoices: Model<SupplyInvoiceDocument>,
    @InjectModel(SupplyRequest.name) private readonly requests: Model<SupplyRequestDocument>,
    private readonly original: PhotoIntakeService,
    private readonly invoiceView: SupplyInvoiceService,
  ) {}

  async import(dto: SupplyInvoiceIntakeDto, actor: string, scope: StockScope | null): Promise<SupplyInvoiceIntakeReceiptDto> {
    await this.assertIndexes();
    const data = prepareInvoiceIntake(dto);
    const existing = await this.byUid(data.payload.uid);
    if (existing) return this.prove(existing, actor, scope, data.payloadHash);

    // Импорт не подбирает складскую позицию или категорию по названию. Видимость проверяется до записи.
    await assertNewDocInScope(this.connection, scope, {}, 'Загрузка счёта без категорий доступна только для основного склада');
    const size = await this.original.assertOriginal(new Types.ObjectId(dto.fileId), dto.sourceSha256, actor);
    const invoiceId = new Types.ObjectId();
    const requestIds = data.payload.lines.map(() => new Types.ObjectId());
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await lockInvoiceIdentity(this.connection, session);
        if (await this.invoices.exists({ intakeUid: dto.uid }).setOptions({ includeSoftDeleted: true }).session(session).exec()) return;
        const supplierName = await this.assertParties(data, session);
        const legacySourceFiles = await this.legacySourceFiles(dto.fileId, dto.sourceSha256, size, session);
        await this.assertNoLegacyOrOtherIntake(data, supplierName, legacySourceFiles, session);
        await this.writeInvoice(data, invoiceId, requestIds, supplierName, actor, session);
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true, wtimeoutMS: 5_000 },
      });
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) throw error;
      const winner = await this.byUid(dto.uid);
      if (winner) return this.prove(winner, actor, scope, data.payloadHash);
      throw new ConflictException('Источник или номер счёта уже использован — сверка обязательна');
    } finally {
      await session.endSession();
    }
    const saved = await this.byUid(dto.uid);
    if (!saved) throw new ServiceUnavailableException('Запись счёта ещё не подтверждена — проверьте квитанцию по ключу');
    return this.prove(saved, actor, scope, data.payloadHash);
  }

  async receipt(uid: string, actor: string, scope: StockScope | null): Promise<SupplyInvoiceIntakeReceiptDto> {
    await this.assertIndexes();
    const invoice = await this.byUid(uid);
    if (!invoice) throw new NotFoundException('Квитанция счёта не найдена');
    return this.prove(invoice, actor, scope);
  }

  private async assertIndexes(): Promise<void> {
    const indexes = await this.invoices.collection.indexes().catch(() => []);
    const ready = Object.entries(SUPPLY_INTAKE_INDEXES).every(([field, name]) => indexes.some(index =>
      index.name === name && Object.keys(index.key).length === 1 && index.key[field] === 1
      && index.unique === true && index.sparse === true
      && !index.partialFilterExpression && !index.hidden && index.expireAfterSeconds === undefined
      && (!index.collation || index.collation.locale === 'simple')));
    if (!ready) throw new ServiceUnavailableException('Индексы загрузки счетов ещё не подготовлены');
  }

  private byUid(uid: string): Promise<Invoice | null> {
    return this.invoices.findOne({ intakeUid: uid }).setOptions({ includeSoftDeleted: true })
      .select(RECEIPT_FIELDS).readConcern('linearizable').maxTimeMS(5_000).lean().exec();
  }

  private async assertParties(data: PreparedInvoiceIntake, session: ClientSession): Promise<string> {
    const supplierId = new Types.ObjectId(data.payload.supplierId);
    const payerId = new Types.ObjectId(data.payload.payerCompanyId);
    const parties = await this.connection.collection('organizations').find(
      { _id: { $in: [supplierId, payerId] }, deletedAt: null },
      { projection: { name: 1, shortName: 1, inn: 1, type: 1, isOurCompany: 1 }, session },
    ).toArray();
    const payer = parties.find(org => payerId.equals(org._id));
    const supplier = parties.find(org => supplierId.equals(org._id));
    if (payer?.isOurCompany !== true) throw new BadRequestException('Выберите действующую нашу компанию');
    if (!supplier || supplier.isOurCompany === true || ![supplier.type].flat().includes('supplier')) {
      throw new BadRequestException('Выберите действующего внешнего поставщика');
    }
    for (const party of [payer, supplier]) {
      if (validateSync(Object.assign(new IntakeParty(), { inn: party.inn })).length) {
        throw new BadRequestException('У поставщика и нашей компании должен быть действительный ИНН');
      }
    }
    if (payer.inn === supplier.inn) throw new BadRequestException('ИНН поставщика и нашей компании должны отличаться');
    return String(supplier.shortName || supplier.name || '');
  }

  /** У старых карточек SHA мог не записываться: сверяем физические PDF среди файлов счетов. */
  private async legacySourceFiles(fileId: string, sha256: string, size: number, session: ClientSession): Promise<Types.ObjectId[]> {
    const matches = [new Types.ObjectId(fileId)];
    const cursor = this.connection.collection('photos').aggregate<{
      _id: Types.ObjectId; storageUrl?: string; sha256?: string;
    }>([
      { $match: { $or: [
        { sha256 },
        { sizeBytes: { $in: [size, null] }, $or: [
          { mimeType: 'application/pdf' }, { storageUrl: /\.pdf$/i },
        ] },
      ] } },
      { $lookup: { from: 'supplyinvoices', localField: '_id', foreignField: 'fileIds', as: 'invoices' } },
      { $match: { 'invoices.0': { $exists: true } } },
      { $project: { storageUrl: 1, sha256: 1 } },
    ], { maxTimeMS: 12_000, session });
    for await (const photo of cursor) {
      if (photo.sha256 === sha256) {
        matches.push(photo._id);
        continue;
      }
      const path = safeUploadPath(photo.storageUrl);
      if (!path) continue;
      const info = await fs.lstat(path).catch(() => null);
      if (!info?.isFile() || info.size !== size) continue;
      const bytes = await inspectIntakePdf(path, size);
      if (bytes?.pdf && bytes.sha256 === sha256) matches.push(photo._id);
    }
    return matches;
  }

  private async assertNoLegacyOrOtherIntake(
    data: PreparedInvoiceIntake, supplierName: string, sourceFiles: Types.ObjectId[], session: ClientSession,
  ): Promise<void> {
    const { payerCompanyId, supplierId, sourceSha256, date } = data.payload;
    const duplicated = await this.invoices.collection.findOne({ $or: [
      { intakeBusinessKey: data.businessKey }, { intakeSourceSha256: sourceSha256 }, { fileIds: { $in: sourceFiles } },
    ] }, { projection: { _id: 1 }, session });
    if (duplicated) throw new ConflictException('Счёт с этим ключом или оригиналом уже сохранён, в том числе в корзине');

    const supplierMatch = { supplierId: { $in: [new Types.ObjectId(supplierId), supplierId] } };
    const oldInvoices = this.connection.collection('supplyinvoices').find(
      { $or: [supplierMatch, { supplierId: null, supplierName }] },
      { projection: { no: 1, date: 1, payerCompanyId: 1 }, session },
    );
    for await (const row of oldInvoices) {
      if (legacyInvoiceKeyMatches(row.no, row.date, row.payerCompanyId, data.noKey, date, payerCompanyId)) {
        throw new ConflictException('Счёт поставщика с таким номером и датой уже существует или удалён');
      }
    }
    const oldRequests = this.connection.collection('supplyrequests').find(
      { ...supplierMatch, invoiceNo: { $type: 'string' } },
      { projection: { invoiceNo: 1, invoiceDate: 1, companyId: 1 }, session },
    );
    for await (const row of oldRequests) {
      if (legacyInvoiceKeyMatches(row.invoiceNo, row.invoiceDate, row.companyId, data.noKey, date, payerCompanyId)) {
        throw new ConflictException('Счёт уже указан в действующих или удалённых заявках поставщика — нужна ручная сверка');
      }
    }
  }

  private async writeInvoice(
    data: PreparedInvoiceIntake, invoiceId: Types.ObjectId, requestIds: Types.ObjectId[],
    supplierName: string, actor: string, session: ClientSession,
  ): Promise<void> {
    const { uid, sourceSha256, no, gross, lines } = data.payload;
    const supplierId = new Types.ObjectId(data.payload.supplierId);
    const payerCompanyId = new Types.ObjectId(data.payload.payerCompanyId);
    const userId = new Types.ObjectId(actor);
    const intakeLines = lines.map((line, index) => ({ requestId: requestIds[index], rowKey: line.rowKey }));
    const clientUids = lines.map(line => intakeLineUid(uid, line.rowKey));
    const reusedUid = await this.requests.exists({ clientUid: { $in: clientUids } })
      .setOptions({ includeSoftDeleted: true }).session(session).exec();
    if (reusedUid) throw new ConflictException('Ключ импортируемой строки уже занят другой заявкой');
    const firstNum = await this.allocateRequestNumbers(lines.length, session);
    await this.invoices.create([{
      _id: invoiceId, no, date: data.date, supplierId, supplierName, payerCompanyId,
      ...data.headerTax, amount: gross, status: 'draft', fileIds: [new Types.ObjectId(data.payload.fileId)],
      financialLines: Object.fromEntries(lines.map((line, index) => [
        String(requestIds[index]), { sourceUnitPrice: line.unitPrice, sourceLineAmount: line.amount },
      ])),
      createdBy: userId, intakeUid: uid, intakeBusinessKey: data.businessKey,
      intakeSourceSha256: sourceSha256, intakePayloadHash: data.payloadHash, intakeLines,
    }], { session });
    await this.requests.insertMany(lines.map((line, index) => ({
      _id: requestIds[index], invoiceId, invoiceNo: no, invoiceDate: data.date, requestDate: data.date,
      title: line.title, qty: line.qty, unit: line.unit, priceHint: data.pricesRub[index],
      companyId: payerCompanyId, supplierId, status: 'ordered', paid: false, priority: 'normal',
      num: firstNum + index, clientUid: clientUids[index], createdBy: userId, editedInApp: true,
    })), { session, ordered: true });
  }

  private async allocateRequestNumbers(count: number, session: ClientSession): Promise<number> {
    const last = await this.requests.findOne({ num: { $type: 'number' } }).setOptions({ includeSoftDeleted: true })
      .sort({ num: -1 }).select('num').session(session).lean().exec();
    // Тот же сквозной счётчик, что у обычного создания заявки, резервируем диапазон в этой транзакции.
    const result = await this.connection.collection<{ seq: number }>('counters').findOneAndUpdate(REQUEST_COUNTER, [
      { $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, last?.num ?? 0] }, count] } } },
    ], { session, upsert: true, returnDocument: 'after' });
    if (!result || !Number.isSafeInteger(result.seq)) throw new ServiceUnavailableException('Не удалось выделить номера заявок');
    return result.seq - count + 1;
  }

  private async prove(
    inv: Invoice, actor: string, scope: StockScope | null, expectedHash?: string,
  ): Promise<SupplyInvoiceIntakeReceiptDto> {
    const changed = () => new ConflictException('Счёт, его строки или источник изменились — нужна ручная сверка');
    if (inv.deletedAt || inv.status === 'cancelled' || !inv.intakeUid || !inv.intakePayloadHash
      || !inv.intakeSourceSha256 || String(inv.createdBy) !== actor || (expectedHash && expectedHash !== inv.intakePayloadHash)) throw changed();
    await this.invoiceView.assertWhole(String(inv._id), scope);
    const rows = await this.requests.find({ invoiceId: inv._id }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!inv.intakeLines?.length || inv.intakeLines.length !== rows.length || inv.fileIds.length !== 1) throw changed();
    const byId = new Map(rows.map(row => [String(row._id), row]));
    const storedPrices: number[] = [];
    const financial = inv.financialLines as Record<string, { sourceUnitPrice?: number; sourceLineAmount?: number }> | undefined;
    const lines = inv.intakeLines.map(({ requestId, rowKey }) => {
      const row = byId.get(String(requestId));
      const meta = financial?.[String(requestId)];
      if (!row || row.deletedAt || row.status === 'cancelled' || !meta || !row.title || !row.unit
        || meta.sourceUnitPrice === undefined || meta.sourceLineAmount === undefined || row.priceHint === undefined
        || row.clientUid !== intakeLineUid(inv.intakeUid!, rowKey) || row.invoiceNo !== inv.no
        || !(row.invoiceDate instanceof Date) || !(inv.date instanceof Date) || row.invoiceDate.getTime() !== inv.date.getTime()
        || String(row.companyId) !== String(inv.payerCompanyId)
        || String(row.supplierId) !== String(inv.supplierId)) throw changed();
      byId.delete(String(requestId));
      storedPrices.push(row.priceHint);
      return { rowKey, title: row.title, qty: row.qty, unit: row.unit, unitPrice: meta.sourceUnitPrice, amount: meta.sourceLineAmount };
    });
    let current: PreparedInvoiceIntake;
    try {
      current = prepareInvoiceIntake({
        uid: inv.intakeUid, sourceSha256: inv.intakeSourceSha256, fileId: String(inv.fileIds[0]),
        supplierId: String(inv.supplierId), payerCompanyId: String(inv.payerCompanyId), no: inv.no!,
        date: inv.date!.toISOString().slice(0, 10), currency: inv.currency as 'RUB', gross: inv.amount!,
        vatMode: inv.vatMode as SupplyIntakeVatMode, vatRate: inv.vatRate ?? undefined,
        vatAmount: inv.declaredVatAmount ?? undefined, lines,
      });
    } catch {
      throw changed();
    }
    if (current.payloadHash !== inv.intakePayloadHash || current.businessKey !== inv.intakeBusinessKey
      || storedPrices.some((price, index) => cents(price) !== cents(current.pricesRub[index]))) throw changed();
    try {
      await this.original.assertOriginal(inv.fileIds[0], inv.intakeSourceSha256, actor);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw changed();
      throw error;
    }
    return {
      uid: inv.intakeUid, sourceSha256: inv.intakeSourceSha256, invoiceId: String(inv._id),
      requestIds: inv.intakeLines.map(line => String(line.requestId)), payloadHash: inv.intakePayloadHash,
    };
  }
}
