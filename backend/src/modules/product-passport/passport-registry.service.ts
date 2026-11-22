import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { stat } from 'fs/promises';
import { Types, type ClientSession, type Connection, type Model, type mongo } from 'mongoose';
import { legalHash } from '../../common/legal/legal-utils';
import { oid, parseList } from '../../common/list-query';
import { withOrderWrite } from '../../common/order-archive/write';
import { selectionOf } from '../../common/passport/line-source';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { selectedAttachments, effectiveAttachment } from '../productattachments/attachment-availability';
import { isIssued, readinessOf } from './passport-consts';
import { PassportHandover, PassportHandoverDocument } from './passport-handover.schema';

type Db = NonNullable<Connection['db']>;
type Row = mongo.Document;
const asId = (value: unknown) => value == null ? '' : String(value);
const stateReady = (line: RegistryLine) => line.state === 'issued' || line.state === 'attached';
const moscowDay = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export interface RegistryLine {
  incomeId: string;
  lineNo: number | null;
  title: string;
  qty: number | null;
  state: 'missing' | 'draft' | 'check' | 'issued' | 'attached';
  document?: { id: string; number?: string; revision?: number; fileName?: string; fileVersion?: string };
  note?: string;
  handedOn?: string;
}
export interface HandoverInput { clientUid: string; fingerprint: string; recipient: string; handedOn: string; incomeIds?: string[] }

function documentKey(line: RegistryLine) {
  const doc = line.document;
  if (!line.incomeId || !doc?.id || !stateReady(line)) return null;
  if (line.state === 'issued' ? !doc.revision : !doc.fileVersion) return null;
  return JSON.stringify([line.incomeId, line.state, doc.id, doc.revision, doc.fileVersion]);
}

function group(rows: Row[], key: string) {
  const result = new Map<string, Row[]>();
  for (const row of rows) {
    const id = asId(row[key]);
    if (!result.has(id)) result.set(id, []);
    result.get(id)!.push(row);
  }
  return result;
}

async function registryLine(line: mongo.WithId<Row>, docs: Row[], attachments: Awaited<ReturnType<typeof selectedAttachments>>, products: Set<string>): Promise<RegistryLine> {
  const base = { incomeId: String(line._id), lineNo: line.lineNo ?? null, title: String(line.title || 'Позиция без названия'), qty: line.qty ?? null };
  const selection = selectionOf(line);
  if (selection.mode === 'attachment') {
    const chosen = attachments.get(asId(selection.attachmentId));
    const { attachment, missing } = effectiveAttachment(line, chosen, products.has(asId(line.productId)));
    if (!attachment?.available) return { ...base, state: 'check', note: missing[0] || 'Вложенный паспорт недоступен' };
    return { ...base, state: 'attached', document: {
      id: attachment.id, fileName: attachment.originalName,
      fileVersion: legalHash([attachment.id, attachment.selectionGeneration, attachment.size]),
    } };
  }
  if (docs.length > 1) return { ...base, state: 'check', note: 'У позиции несколько паспортов. Уточните действующий.' };
  const doc = docs[0];
  if (!doc) return { ...base, state: 'missing' };
  if (!isIssued(doc)) return { ...base, state: 'draft', document: { id: String(doc._id) } };
  const document = { id: String(doc._id), number: String(doc.passportNumber || ''), revision: Number(doc.revision || 1) };
  if (!document.number || readinessOf(doc) !== 'ready') return { ...base, state: 'check', document, note: 'Паспорт требует проверки' };
  if (doc.printFile?.path) {
    const filePath = safeUploadPath(doc.printFile.path);
    const available = filePath && await stat(filePath).then(file => file.isFile(), () => false);
    if (!available) return { ...base, state: 'check', document, note: 'Файл печати недоступен' };
    return { ...base, state: 'issued', document: {
      ...document, fileName: doc.printFile.originalName, fileVersion: legalHash([doc.printFile.path, doc.printFile.uploadedAt]),
    } };
  }
  return { ...base, state: 'issued', document };
}

async function currentLines(db: Db, orderId: Types.ObjectId, session?: ClientSession) {
  const incomes = await db.collection('incomes').find(
    { orderId, deletedAt: null, cancelledAt: null, lineType: { $ne: 'service' } },
    { projection: { lineNo: 1, title: 1, qty: 1, productId: 1, passportSelection: 1 }, session },
  ).sort({ lineNo: 1, _id: 1 }).toArray();
  const all = await db.collection('productpassports').find({
    deletedAt: null, status: { $ne: 'annulled' },
    $or: [{ incomeId: { $in: incomes.map((line) => line._id) } }, { incomeId: null, salesOrderId: orderId }],
  }, { projection: { incomeId: 1, productId: 1, status: 1, readiness: 1, passportNumber: 1, name: 1, revision: 1, printFile: 1 }, session }).toArray();
  const productIds = [...new Set(incomes.filter((line) => selectionOf(line).mode === 'attachment').map((line) => asId(line.productId)))]
    .filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id));
  const liveProducts = productIds.length ? await db.collection('products').find(
    { _id: { $in: productIds }, deletedAt: null }, { projection: { _id: 1 }, session },
  ).toArray() : [];
  const attached = await selectedAttachments(db, incomes, session);
  const direct = group(all.filter((p) => p.incomeId), 'incomeId');
  const legacy = group(all.filter((p) => !p.incomeId), 'productId');
  const unassigned = group(incomes.filter((line) => line.productId && !direct.has(asId(line._id)) && selectionOf(line).mode === 'site'), 'productId');
  // Старый паспорт можно сопоставить только при однозначных изделии и позиции.
  for (const [key, candidates] of unassigned) {
    const passports = legacy.get(key);
    if (candidates.length === 1 && passports?.length === 1) {
      direct.set(asId(candidates[0]._id), passports);
      legacy.delete(key);
    }
  }
  const rows: RegistryLine[] = [];
  const live = new Set(liveProducts.map((product) => String(product._id)));
  for (let at = 0; at < incomes.length; at += 8) {
    const batch = incomes.slice(at, at + 8);
    rows.push(...await Promise.all(batch.map((line) => registryLine(line, direct.get(asId(line._id)) || [], attached, live))));
  }
  return {
    rows, unlinked: [...legacy.values()].flat().map((row) => ({ id: String(row._id), name: row.name, number: isIssued(row) ? row.passportNumber : null })),
  };
}

@Injectable()
export class PassportRegistryService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PassportHandover.name) private readonly receipts: Model<PassportHandoverDocument>,
  ) {}

  async onModuleInit() {
    await this.receipts.createCollection();
    await this.receipts.createIndexes();
  }

  private async view(orderId: Types.ObjectId, session?: ClientSession, includeHistory = true) {
    const db = this.connection.db!;
    const order = await db.collection('salesorders').findOne(
      { _id: orderId, deletedAt: null },
      { projection: { productionNo: 1, orderNo: 1, customer: 1, activeArchiveVersion: 1, cancelledAt: 1 }, session },
    );
    if (!order) throw new NotFoundException('Заказ не найден');
    const { rows, unlinked } = await currentLines(db, orderId, session);
    const ready = rows.filter(stateReady).length;
    const fingerprint = legalHash(rows);
    const history = await this.receipts.find({ orderId }).select(includeHistory ? '-__v -clientUid -selectionHash' : 'rows handedOn')
      .sort('-createdAt -_id').session(session ?? null).lean().exec();
    const handedByVersion = new Map<string, number>();
    for (const [index, receipt] of history.entries()) {
      for (const line of receipt.rows) {
        const key = documentKey(line);
        if (key && !handedByVersion.has(key)) handedByVersion.set(key, index);
      }
    }
    let handed = 0;
    let lastReceipt = history.length;
    for (const line of rows) {
      const key = documentKey(line);
      const index = key ? handedByVersion.get(key) : undefined;
      if (index === undefined) continue;
      line.handedOn = history[index].handedOn;
      handed++;
      lastReceipt = Math.min(lastReceipt, index);
    }
    const current = handed > 0 && handed === rows.length ? history[lastReceipt] : null;
    return {
      orderId: String(orderId), orderNo: order.orderNo || '', productionNo: order.productionNo || '', customer: order.customer || '',
      rows, unlinked, ready, handed, fingerprint, current, history,
      canHandover: !order.activeArchiveVersion && !order.cancelledAt && ready > handed,
    };
  }

  get(id: string) { return this.view(oid(id, 'заказа')); }

  async list(q: { search?: string; state?: string; page?: string; limit?: string }) {
    const { page, limit, skip, search } = parseList({ ...q, search: String(q.search || '').slice(0, 120) },
      { sortable: ['createdAt'], defaultSort: '-createdAt', defaultLimit: 20, maxLimit: 50 });
    const mode = q.state;
    const work = mode === 'work' || mode === 'handover';
    const history = mode === 'history';
    const db = this.connection.db!;
    const candidates = db.collection('salesorders');
    const pipeline: Row[] = [
      { $match: {
        deletedAt: null, ...(history ? {} : { cancelledAt: null }),
        ...(work ? { activeArchiveVersion: null, stage: { $nin: ['closed', 'cancelled'] } } : {}),
        ...(search ? { $or: [{ orderNo: search }, { productionNo: search }, { customer: search }] } : {}),
      } },
      { $lookup: {
        from: history ? 'passporthandovers' : 'incomes', let: { orderId: '$_id' }, as: 'matched',
        pipeline: [
          { $match: { $expr: { $eq: ['$orderId', '$$orderId'] },
            ...(history ? {} : { deletedAt: null, cancelledAt: null, lineType: { $ne: 'service' } }) } },
          { $limit: 1 }, { $project: { _id: 1 } },
        ],
      } },
      { $match: { 'matched.0': { $exists: true } } },
    ];
    pipeline.push({ $sort: { createdAt: -1, _id: -1 } }, { $project: { _id: 1 } });
    const renderRow = (view: Awaited<ReturnType<PassportRegistryService['view']>>) => ({
      id: view.orderId, orderNo: view.orderNo, productionNo: view.productionNo, customer: view.customer,
      ready: view.ready, handed: view.handed, positions: view.rows.length, handedOn: view.current?.handedOn ?? null,
    });
    if (!work) {
      const [result] = await candidates.aggregate<{ items: { _id: Types.ObjectId }[]; total: { value: number }[] }>([
        ...pipeline, { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'value' }] } },
      ]).toArray();
      const items = await Promise.all(result.items.map(async (order) => renderRow(await this.view(order._id, undefined, false))));
      return { items, total: result.total[0]?.value ?? 0, page, limit };
    }
    const items = [];
    let total = 0;
    for await (const order of candidates.aggregate<{ _id: Types.ObjectId }>(pipeline)) {
      const view = await this.view(order._id, undefined, false);
      if (!view.rows.length || view.current || (mode === 'handover' && !view.canHandover)) continue;
      if (total >= skip && items.length < limit) items.push(renderRow(view));
      total++;
    }
    return { items, total, page, limit };
  }

  async handover(id: string, dto: HandoverInput, actorId: string, actorName: string) {
    const orderId = oid(id, 'заказа');
    const recipient = dto.recipient.trim();
    const selected = dto.incomeIds && new Set(dto.incomeIds.map(id => id.toLowerCase()));
    const selectionHash = selected && legalHash([...selected].sort());
    const day = new Date(dto.handedOn + 'T00:00:00.000Z');
    if (!recipient) throw new BadRequestException('Укажите получателя паспортов');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== dto.handedOn || dto.handedOn > moscowDay()) {
      throw new BadRequestException('Укажите действительную дату передачи');
    }
    return withOrderWrite(this.connection, [orderId], async (session) => {
      const repeated = await this.receipts.findOne({ orderId, clientUid: dto.clientUid }).session(session).lean().exec();
      if (repeated) {
        if (repeated.recipient !== recipient || repeated.handedOn !== dto.handedOn ||
          repeated.fingerprint !== dto.fingerprint || repeated.selectionHash !== selectionHash) {
          throw new ConflictException('Эта передача уже записана с другими данными');
        }
        return this.view(orderId, session);
      }
      const view = await this.view(orderId, session);
      if (view.fingerprint !== dto.fingerprint) throw new ConflictException('Комплект изменился. Откройте реестр заново.');
      if (!view.canHandover) throw new ConflictException('В этом договоре сейчас нет позиций, доступных для передачи.');
      if (!selected && view.ready !== view.rows.length) throw new ConflictException('Комплект ещё не готов. Выберите готовые позиции.');
      const rows = view.rows.filter(line => stateReady(line) && !line.handedOn && (!selected || selected.has(line.incomeId)));
      if (selected && rows.length !== selected.size) throw new ConflictException('Часть выбранных позиций недоступна или уже передана. Обновите реестр.');
      await this.receipts.create([{
        orderId, clientUid: dto.clientUid, fingerprint: dto.fingerprint, selectionHash, recipient, handedOn: dto.handedOn,
        actorId: oid(actorId, 'пользователя'), actorName, rows,
      }], { session });
      return this.view(orderId, session);
    });
  }
}
