import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Types, mongo, type ClientSession, type Connection } from 'mongoose';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { legalHash } from '../../common/legal/legal-utils';
import { canSeeMoney, effectiveRoles } from '../../common/roles-hierarchy';
import { ArchiveCloseCommand, ArchiveCommand } from './order-archive.dto';
import { archiveFacts, blockers, type Blocker, type Facts } from './order-archive-facts';
import { commitFiles, fileError, prepareFiles } from './order-archive-files';
import { ARCHIVES, CHUNKS, REOPENS, type ArchiveFile } from './order-archive.schema';

const missing = () => new NotFoundException('Архивный комплект или договор не найден');
const stale = () => new ConflictException({ code: 'ARCHIVE_STALE', message: 'Состояние договора изменилось. Откройте карточку заново' });
const oid = (id: string) => { if (!/^[a-f\d]{24}$/i.test(id)) throw missing(); return new Types.ObjectId(id); };
const fields = (doc: mongo.Document, keys: string[]) => Object.fromEntries(keys.filter(k => doc[k] !== undefined).map(k => [k, doc[k]]));
const monetary = (actor?: AuthenticatedUser) => !!actor && !actor.keyScope && canSeeMoney(actor);
const confirmed = ['manufactureComplete', 'servicesComplete', 'installationComplete', 'documentsComplete'] as const;
const clock = (o: mongo.Document) => Number(o.archiveStateVersion ?? 0);
function requireHuman(actor: AuthenticatedUser | undefined, reopen = false): asserts actor is AuthenticatedUser {
  if (!actor?.id || actor.keyScope || !sectionOpen(openSectionsFor(actor), 'salesorders')
    || !(reopen ? actor.role === 'admin' : monetary(actor) && effectiveRoles(actor.role).includes('manager')))
    throw new ForbiddenException(reopen ? 'Возобновить договор может администратор под личной учётной записью' : 'Нужны личная учётная запись, право правки договора и доступ к оплате');
}
function validCommand(dto: ArchiveCommand) {
  if (typeof dto.reason !== 'string' || dto.reason.trim().length < 3 || dto.reason.length > 1000 || !dto.clientUid?.trim()
    || !Number.isSafeInteger(dto.expectedStateVersion) || dto.expectedStateVersion < 0) throw new BadRequestException('Укажите причину и версию состояния договора');
}
function factHash(f: Facts) {
  // Служебный паспортный барьер изменяется первым действием фиксации.
  const order = { ...f.order };
  delete order.passportGuard;
  return legalHash({ ...f, order });
}
function allowedFiles(actor?: AuthenticatedUser) {
  // Комплект включает договорные и паспортные оригиналы. Прикреплённый PDF может содержать суммы.
  const open = openSectionsFor(actor);
  return monetary(actor) && sectionOpen(open, 'salesorders') && sectionOpen(open, 'passports');
}
@Injectable()
export class OrderArchiveService implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly modules: ModuleRef) {}
  private get db() { return this.connection.db!; }

  async onApplicationBootstrap() {
    // На рабочей VM autoIndex выключен. Индексы создаются до первой архивной транзакции.
    await this.db.collection(ARCHIVES).createIndex({ orderId: 1, version: 1 }, { unique: true });
    await this.db.collection(ARCHIVES).createIndex({ 'files.sourceId': 1 });
    await this.db.collection(REOPENS).createIndex({ orderId: 1, version: 1 }, { unique: true });
    await this.db.collection(CHUNKS).createIndex({ orderId: 1, version: 1, fileId: 1, seq: 1 }, { unique: true });
  }

  private async order(orderId: Types.ObjectId, session?: ClientSession, historical = false) {
    const o = await this.db.collection('salesorders').findOne({ _id: orderId, ...(historical ? {} : { deletedAt: null }) }, { session });
    if (!o) throw missing();
    return o;
  }
  private async transaction<T>(run: (session: ClientSession) => Promise<T>) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => run(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (e) {
      if ([50, 225, 251, 10334].includes(Number((e as { code?: number }).code)))
        fileError('Комплект не удалось зафиксировать целиком за одну транзакцию. Изменения отменены', 'ARCHIVE_TRANSACTION_LIMIT');
      throw e;
    } finally { await session.endSession(); }
  }
  private async prior(orderId: Types.ObjectId, dto: ArchiveCommand, kind: string, actor: AuthenticatedUser, session?: ClientSession) {
    const requestHash = legalHash({ actorId: actor.id, kind, ...dto });
    for (const collection of [ARCHIVES, REOPENS]) {
      const previous = await this.db.collection(collection).findOne({ orderId, clientUid: dto.clientUid }, { session, projection: { requestHash: 1, version: 1, stateVersion: 1 } });
      if (!previous) continue;
      if (previous.requestHash !== requestHash) throw new ConflictException({ code: 'ARCHIVE_UID_CONFLICT', message: 'Этот ключ уже использован для другой команды' });
      return { requestHash, receipt: { version: Number(previous.version), stateVersion: Number(previous.stateVersion) } };
    }
    return { requestHash, receipt: null };
  }

  async readiness(id: string, evidence: string | undefined, actor?: AuthenticatedUser) {
    requireHuman(actor);
    const o = await this.order(oid(id));
    const f = await archiveFacts(this.db, o);
    const errors = blockers(f, evidence, !evidence);
    if (o.activeArchiveVersion) errors.unshift({ code: 'ORDER_ARCHIVED', message: 'Договор уже в архиве' });
    if (!errors.length) {
      try { await prepareFiles(this.db, f, this.modules); }
      catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        const report = e.getResponse() as { blockers?: Blocker[] };
        if (!report.blockers) throw e;
        errors.push(...report.blockers);
      }
    }
    return { ready: !errors.length, stateVersion: clock(o), blockers: errors };
  }

  async close(id: string, dto: ArchiveCloseCommand, actor?: AuthenticatedUser) {
    requireHuman(actor);
    validCommand(dto);
    if (confirmed.some(k => dto[k] !== true)) throw new BadRequestException('Подтвердите изготовление, услуги, монтаж и передачу документов в применимой части договора');
    const orderId = oid(id);
    const seen = await this.prior(orderId, dto, 'close', actor);
    if (seen.receipt) return seen.receipt;
    const first = await this.order(orderId);
    if (clock(first) !== dto.expectedStateVersion || first.activeArchiveVersion) {
      const concurrent = await this.prior(orderId, dto, 'close', actor);
      if (concurrent.receipt) return concurrent.receipt;
      throw stale();
    }
    const before = await archiveFacts(this.db, first);
    const check = (facts: Facts) => {
      const errors = blockers(facts, dto.evidenceDocumentUid);
      if (errors.length) throw new ConflictException({ code: 'ORDER_ARCHIVE_BLOCKED', blockers: errors, message: errors.map(x => x.message) });
    };
    check(before);
    const preparedHash = factHash(before);
    const prepared = await prepareFiles(this.db, before, this.modules);
    return this.transaction(async session => {
      const orders = this.db.collection('salesorders');
      // Применённая команда ничего не пишет. Новая берёт общий барьер до чтения фактов.
      const replay = await this.prior(orderId, dto, 'close', actor, session);
      if (replay.receipt) return replay.receipt;
      const lock = await orders.updateOne({ _id: orderId, deletedAt: null }, { $inc: { passportGuard: 1 } }, { session });
      if (!lock.modifiedCount) throw missing();
      const o = await this.order(orderId, session);
      if (clock(o) !== dto.expectedStateVersion || o.activeArchiveVersion) throw stale();
      const facts = await archiveFacts(this.db, o, session);
      check(facts);
      if (factHash(facts) !== preparedHash) throw stale();
      const prev = await this.db.collection(ARCHIVES).findOne({ orderId }, { session, sort: { version: -1 }, projection: { version: 1 } });
      const version = Number(prev?.version ?? 0) + 1, stateVersion = clock(o) + 1;
      const archivedAt = new Date(), reason = dto.reason.trim();
      const files = await commitFiles(this.db, orderId, version, prepared, session);
      const snapshot = { ...facts, files, order: { ...o, stage: 'closed', activeArchiveVersion: version, archiveStateVersion: stateVersion },
        orderId, version, stateVersion, archivedAt, archivedBy: actor.username, actorId: actor.id, reason, clientUid: dto.clientUid, requestHash: seen.requestHash,
        confirmations: { ...fields(dto, [...confirmed, 'evidenceDocumentUid']), incomeIds: facts.lines.filter(l => !l.cancelledAt).map(l => l._id) },
        paymentFacts: facts.lines.filter(l => !l.cancelledAt).map(l => ({ incomeId: l._id, legacy: !l.payments?.length && !!l.paidDate })) };
      if (mongo.BSON.calculateObjectSize(snapshot) > 15 * 1024 * 1024) fileError('Снимок данных превысил предел документа MongoDB', 'ARCHIVE_TOO_LARGE');
      await this.db.collection(ARCHIVES).insertOne(snapshot, { session });
      await orders.updateOne({ _id: orderId }, { $set: { stage: 'closed', activeArchiveVersion: version, archiveStateVersion: stateVersion, updatedAt: archivedAt } }, { session });
      await this.audit(orderId, actor, 'salesorder.archived', version, reason, archivedAt, session);
      return { version, stateVersion };
    });
  }

  async reopen(id: string, dto: ArchiveCommand, actor?: AuthenticatedUser) {
    requireHuman(actor, true);
    validCommand(dto);
    const orderId = oid(id);
    return this.transaction(async session => {
      const orders = this.db.collection('salesorders');
      const seen = await this.prior(orderId, dto, 'reopen', actor, session);
      if (seen.receipt) return seen.receipt;
      const lock = await orders.updateOne({ _id: orderId, deletedAt: null }, { $inc: { passportGuard: 1 } }, { session });
      if (!lock.modifiedCount) throw missing();
      const o = await this.order(orderId, session);
      if (clock(o) !== dto.expectedStateVersion || !o.activeArchiveVersion) throw stale();
      const version = Number(o.activeArchiveVersion), stateVersion = clock(o) + 1;
      const source = await this.db.collection(ARCHIVES).findOne({ orderId, version }, { session, projection: { 'lines.lineType': 1, 'lines.cancelledAt': 1 } });
      if (!source) throw missing();
      const reopenedAt = new Date(), reopenReason = dto.reason.trim();
      await this.db.collection(REOPENS).insertOne({ orderId, version, stateVersion, reopenedAt, reopenedBy: actor.username, actorId: actor.id, reopenReason,
        clientUid: dto.clientUid, requestHash: seen.requestHash }, { session });
      const stage = source.lines.some((l: mongo.Document) => !l.cancelledAt && l.lineType !== 'service') ? 'shipped' : 'ready';
      await orders.updateOne({ _id: orderId, activeArchiveVersion: version },
        { $unset: { activeArchiveVersion: '' }, $set: { archiveStateVersion: stateVersion, stage, updatedAt: reopenedAt } }, { session });
      await this.audit(orderId, actor, 'salesorder.archive.reopened', version, reopenReason, reopenedAt, session);
      return { version, stateVersion };
    });
  }

  private audit(orderId: Types.ObjectId, actor: AuthenticatedUser, action: string, version: number, reason: string, at: Date, session: ClientSession) {
    return this.db.collection('auditlogs').insertOne({ action, entityType: 'SalesOrder', entityId: orderId, userId: new Types.ObjectId(actor.id),
      createdAt: at, details: { meta: { version, reason } } }, { session });
  }

  async history(id: string, actor?: AuthenticatedUser) {
    const orderId = oid(id);
    const o = await this.order(orderId, undefined, true);
    const projection = { _id: 0, version: 1, archivedAt: 1, archivedBy: 1, ...(monetary(actor) ? { reason: 1 } : {}) };
    const events = await this.db.collection(REOPENS).find({ orderId }, { projection: { _id: 0, version: 1, reopenedAt: 1, reopenedBy: 1, ...(monetary(actor) ? { reopenReason: 1 } : {}) } }).toArray();
    const reopened = new Map(events.map(x => [x.version, x]));
    const history = await this.db.collection(ARCHIVES).find({ orderId }, { projection }).sort({ version: -1 }).toArray();
    const items = history.map(x => ({ ...x, ...reopened.get(x.version) }));
    return { activeArchiveVersion: o.activeArchiveVersion ?? null, stateVersion: clock(o), items, total: items.length };
  }

  private async version(id: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw missing();
    const doc = await this.db.collection(ARCHIVES).findOne({ orderId: oid(id), version });
    if (!doc) throw missing();
    return doc;
  }
  async detail(id: string, version: number, actor?: AuthenticatedUser) {
    const a = await this.version(id, version);
    const open = openSectionsFor(actor), money = monetary(actor);
    const pass = !actor?.keyScope && sectionOpen(open, 'passports');
    const orderKeys = ['_id', 'orderNo', 'title', 'customer', 'contractNo', 'contractDate', 'productionNo', 'stage', 'shipDate', 'activeArchiveVersion'];
    const lineKeys = ['_id', 'lineNo', 'title', 'unit', 'qty', 'productId', 'lineType', 'cancelledAt'];
    return { version, archivedAt: a.archivedAt, archivedBy: a.archivedBy,
      ...(money ? { reason: a.reason, confirmations: a.confirmations, paymentFacts: a.paymentFacts, organizations: a.organizations } : {}),
      order: fields(a.order, [...orderKeys, ...(money ? ['companyId', 'counterpartyId', 'legal', 'legalHistory', 'paymentForm', 'notes'] : [])]),
      lines: a.lines.map((l: mongo.Document) => fields(l, [...lineKeys, ...(money ? ['sourceLine', 'payments', 'paidAmount', 'amount', 'unitPrice', 'amountManual', 'paidDate', 'legacyPaymentMetadata'] : [])])),
      work: !actor?.keyScope && sectionOpen(open, 'work') ? a.work.map((t: mongo.Document) => fields(t, ['_id', 'seq', 'status', 'incomeId', 'route', 'completedAt'])) : [],
      plans: !actor?.keyScope && sectionOpen(open, 'work') ? a.plans.map((p: mongo.Document) => fields(p, ['_id', 'incomeId', 'parts', 'steps', 'launchedAt'])) : [],
      design: !actor?.keyScope && sectionOpen(open, 'design') ? a.design.map((t: mongo.Document) => fields(t, ['_id', 'seq', 'incomeId', 'title', 'status', 'completedAt'])) : [],
      stockMovements: !actor?.keyScope && sectionOpen(open, 'stock') ? (a.stockMovements ?? []).map((m: mongo.Document) => fields(m, ['_id', 'type', 'date', 'materialId', 'qty', 'salesOrderLineId', 'cancelledAt', 'cancelOf'])) : [],
      reservations: !actor?.keyScope && sectionOpen(open, 'stock') ? a.reservations : [],
      requests: !actor?.keyScope && sectionOpen(open, 'requests') ? a.requests : [],
      shipments: a.shipments.map((s: mongo.Document) => fields(s, ['_id', 'date', 'number', 'lines'])),
      passports: pass ? a.passports.map((p: mongo.Document) => fields(p, ['_id', 'incomeId', 'revision', 'passportNumber', 'status', 'productName', 'productCode', 'warrantyCode'])) : [],
      files: allowedFiles(actor) ? a.files : [] };
  }
  async download(id: string, version: number, fileId: string, actor?: AuthenticatedUser) {
    const a = await this.version(id, version);
    const file = a.files.find((f: ArchiveFile) => f.id === fileId) as ArchiveFile | undefined;
    if (!file) throw missing();
    if (!allowedFiles(actor)) throw new ForbiddenException('Нет доступа к файлу комплекта');
    const rows = await this.db.collection(CHUNKS).find({ orderId: a.orderId, version, fileId }).sort({ seq: 1 }).toArray();
    const bytes = Buffer.concat(rows.map(r => Buffer.from(r.data.buffer)));
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      fileError('Нарушена целостность сохранённого файла');
    return { file, bytes };
  }
}
