import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { legalHash } from '../../common/legal/legal-utils';
import type { StockScope } from '../../common/stock-scope';
import { PhotoIntakeService } from '../photos/photo-intake.service';
import { InvoiceCommitQuery, InvoiceReviewDto, InvoiceReviewVersion } from './dto-invoice-review';
import { lockInvoiceIdentity } from './supply-invoice-identity';
import { prepareInvoiceIntake } from './supply-invoice-intake-values';
import { SupplyInvoiceIntakeService } from './supply-invoice-intake.service';
import { SupplyIntakeReview } from './supply-intake-review.schema';
import { clearReviewFiles, reviewedUrl, stageReviewedPdf } from './supply-intake-storage';

const durable = { w: 'majority' as const, j: true, wtimeoutMS: 5000 };
const stale = () => new ConflictException('Версия проверки или подтверждение изменились. Подготовьте список ещё раз.');
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function scopeKey(scope: StockScope | null) {
  return legalHash(scope?.zones.map(z => [z.id, z.noCategory, [...z.categoryIds].sort(), [...z.includeIds].sort(), [...z.excludeIds].sort()]).sort() ?? null);
}

function reply(draft: SupplyIntakeReview) {
  return { draftId: draft._id, revision: draft.revision, payloadHash: draft.payloadHash, state: draft.state, reason: draft.reason };
}
const prepare = (input: InvoiceReviewDto, fileId: string) => prepareInvoiceIntake({
  ...input.facts, uid: 'c169-' + input.sourceSha256, fileId, sourceSha256: input.sourceSha256,
});
const refused = (err: unknown) => err instanceof ConflictException || err instanceof BadRequestException;
const expires = () => new Date(Date.now() + 10 * 60_000);
const rulesVersion = 'invoice-review-1';
const ticketHash = (ticket: string, contour: string, d: SupplyIntakeReview) =>
  legalHash([rulesVersion, ticket, contour, d.actor, d.scopeHash, d._id, d.revision, d.input.sourceSha256, d.payloadHash]);

@Injectable()
export class SupplyIntakeReviewService {
  constructor(@InjectConnection() private readonly db: Connection,
    @InjectModel(SupplyIntakeReview.name) private readonly drafts: Model<SupplyIntakeReview>,
    private readonly intake: SupplyInvoiceIntakeService, private readonly photos: PhotoIntakeService) {}

  private async load(draftId: string, actor: string, scope: StockScope | null) {
    const draft = await this.drafts.findOne({ _id: draftId, actor, scopeHash: scopeKey(scope) }).readConcern('majority').lean().exec();
    if (!draft) throw new NotFoundException('Проверка документа недоступна');
    return draft;
  }
  async read(id: string, actor: string, scope: StockScope | null) {
    return reply(await this.load(id, actor, scope));
  }

  private async check(input: InvoiceReviewDto, fileId: string, actor: string, scope: StockScope | null) {
    const session = await this.db.startSession();
    try {
      const data = prepare(input, fileId);
      const result = await session.withTransaction(() => this.intake.validateReviewed(data, input.sourceSize, input.facts.supplierInn,
        input.facts.payerInn, actor, scope, session), { readConcern: { level: 'snapshot' } });
      return { payloadHash: data.payloadHash, savedFileId: result.savedFileId };
    } finally { await session.endSession(); }
  }

  async review(input: InvoiceReviewDto, actor: string, scope: StockScope | null) {
    await this.intake.assertIndexes();
    await this.photos.assertUniqueIndex();
    const binding = { _id: input.draftId, actor, scopeHash: scopeKey(scope) };
    const prior = await this.drafts.findOne(binding).readConcern('majority').lean().exec();
    const requestHash = legalHash(input);
    const replay = prior?.requests.find(r => r.requestId === input.requestId);
    if (replay) {
      if (replay.hash !== requestHash) throw stale();
      return replay.reply;
    }
    if ((prior?.revision ?? 0) !== input.expectedRevision || prior && (
      ['committing', 'committed'].includes(prior.state) || prior.input.sourceSha256 !== input.sourceSha256
      || prior.input.batchId !== input.batchId || prior.input.sourceSize !== input.sourceSize)) throw stale();
    // Каждая версия имеет отдельный закрытый путь; очистка отказа не может удалить файл новой версии.
    const fileId = String(new Types.ObjectId(randomBytes(12)));
    let payloadHash = requestHash, reason = '';
    try {
      if (input.withdraw) throw new ConflictException('Поля изменены на ПК. Требуется повторная проверка.');
      payloadHash = (await this.check(input, fileId, actor, scope)).payloadHash;
    }
    catch (err) { if (!refused(err)) throw err; reason = (err as Error).message; }
    const state = reason ? 'question' : 'validated';
    const result = { draftId: input.draftId, revision: input.expectedRevision + 1, payloadHash, state, reason };
    const next = { fileId, requestHash, input, state, reason, revision: result.revision, payloadHash };
    const entry = { requestId: input.requestId, hash: requestHash, reply: result };
    try {
      if (prior) {
        const saved = await this.drafts.updateOne({ ...binding, revision: prior.revision, state: { $in: ['validated', 'question'] } },
          { $set: next, $unset: { ticketHash: 1, expiresAt: 1 }, $push: { requests: entry } }, { writeConcern: durable });
        if (saved.modifiedCount === 1) return result;
      } else {
        await this.drafts.create([{ ...binding, ...next, requests: [entry] }], { writeConcern: durable });
        return result;
      }
    } catch (err) { if ((err as { code?: number }).code !== 11000) throw err; }
    const winner = await this.drafts.findOne(binding).readConcern('majority').lean().exec();
    const done = winner?.requests.find(r => r.requestId === input.requestId && r.hash === requestHash);
    if (done) return done.reply;
    throw stale();
  }

  async prepare(version: InvoiceReviewVersion, actor: string, scope: StockScope | null, contour: string) {
    const draft = await this.load(version.draftId, actor, scope);
    if (draft.revision !== version.revision || draft.payloadHash !== version.payloadHash
      || !['validated', 'committing'].includes(draft.state)) throw stale();
    let savedFileId: string | null;
    try { savedFileId = (await this.check(draft.input, draft.fileId, actor, scope)).savedFileId; }
    catch (err) {
      if (refused(err)) {
        const changed = await this.drafts.updateOne({ _id: draft._id, revision: draft.revision, state: draft.state },
          { $set: { state: 'question', reason: (err as Error).message } }, { writeConcern: durable });
        if (changed.modifiedCount) await clearReviewFiles(draft.fileId, true);
      }
      throw err;
    }
    const ticket = randomBytes(32).toString('hex'), expiresAt = expires();
    const res = await this.drafts.updateOne({ _id: draft._id, revision: draft.revision, state: draft.state },
      { $set: { ticketHash: ticketHash(ticket, contour, draft), expiresAt, ...(savedFileId ? { state: 'committed' } : {}) } }, { writeConcern: durable });
    if (res.modifiedCount !== 1) throw stale();
    if (savedFileId && savedFileId !== draft.fileId) await clearReviewFiles(draft.fileId, true);
    return { ...version, ticket, expiresAt };
  }

  async authorizeUpload(query: InvoiceCommitQuery, actor: string, scope: StockScope | null, contour: string) {
    const draft = await this.load(query.draftId, actor, scope);
    if (draft.ticketHash !== ticketHash(query.ticket, contour, draft) || draft.state === 'question'
      || draft.state !== 'committed' && (!draft.expiresAt || draft.expiresAt <= new Date())) throw stale();
  }

  async commit(query: InvoiceCommitQuery, actor: string, scope: StockScope | null, contour: string, bytes?: Buffer) {
    const d = await this.load(query.draftId, actor, scope);
    const uid = 'c169-' + d.input.sourceSha256;
    if (d.ticketHash !== ticketHash(query.ticket, contour, d)) throw stale();
    if (d.state === 'committed') return this.intake.receipt(uid, actor, scope);
    if (!d.expiresAt || d.expiresAt <= new Date() || !['committing','validated'].includes(d.state)) throw stale();
    if (!bytes || bytes.length !== d.input.sourceSize || bytes.subarray(0, 5).toString() !== '%PDF-' || digest(bytes) !== d.input.sourceSha256)
      throw new BadRequestException('Размер, тип или контрольная сумма PDF не совпадают с проверкой');
    await this.intake.assertIndexes();
    await this.photos.assertUniqueIndex();
    const claims = { _id: d._id, actor, scopeHash: d.scopeHash, revision: d.revision, ticketHash: d.ticketHash, payloadHash: d.payloadHash };
    const intent = await this.drafts.updateOne({ ...claims, expiresAt: { $gt: new Date() }, state: { $in: ['validated','committing'] } },
      { $set: { state: 'committing' } }, { writeConcern: durable });
    if (!intent.matchedCount) {
      if ((await this.load(d._id, actor, scope)).state === 'committed') return this.intake.receipt(uid, actor, scope);
      throw stale();
    }
    const session = await this.db.startSession();
    let savedFileId: string | null = null;
    try {
      await session.withTransaction(async () => {
        await lockInvoiceIdentity(this.db, session);
        const claimed = await this.drafts.updateOne({ ...claims, expiresAt: { $gt: new Date() }, state: 'committing' },
          { $set: { state: 'committed' } }, { session });
        if (!claimed.matchedCount) {
          if (await this.drafts.exists({ ...claims, state: 'committed' }).session(session)) return;
          throw stale();
        }
        const data = prepare(d.input, d.fileId);
        if (data.payloadHash !== d.payloadHash) throw stale();
        const checked = await this.intake.validateReviewed(data, bytes.length, d.input.facts.supplierInn, d.input.facts.payerInn, actor, scope, session);
        savedFileId = checked.savedFileId;
        if (savedFileId) return;
        await this.intake.writeReviewed(data, checked.supplierName, actor, session);
        await this.photos.createReviewed(d.fileId, uid, d.input.sourceSha256, bytes.length, actor, reviewedUrl(d.fileId), session);
        // До commit Mongo ссылка недоступна. Падение оставляет только закрытые байты + durable intent.
        await stageReviewedPdf(d.fileId, bytes, d.input.sourceSha256);
      }, { readConcern: { level: 'snapshot' }, writeConcern: durable });
    } catch (err) {
      const duplicate = (err as { code?: number }).code === 11000;
      if (refused(err) || duplicate) {
        const reason = duplicate ? 'Ключ счёта или оригинала уже занят' : (err as Error).message;
        const rejected = await this.drafts.updateOne({ ...claims, state: 'committing' },
          { $set: { state: 'question', reason } }, { writeConcern: durable });
        if (rejected.modifiedCount) await clearReviewFiles(d.fileId, true);
        throw new ConflictException(reason);
      }
      // Неопределённый исход транзакции сверяется по UID при следующем запросе.
      throw new ServiceUnavailableException('Отправка ещё не подтверждена. Повторите сверку квитанции.');
    } finally { await session.endSession(); }
    if (savedFileId && savedFileId !== d.fileId) await clearReviewFiles(d.fileId, true);
    return this.intake.receipt(uid, actor, scope);
  }
}
