import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { ProductPassportDocument } from './product-passport.schema';
import { dayUtc } from './passport-rules';
import { assertNotExternal, escapeRe, isDraftNumber, isIssued, type Doc } from './passport-consts';

/** Что выпуску нужно от сервиса паспортов. */
export interface IssueHost {
  model: Model<ProductPassportDocument>;
  connection: Connection;
  findById: (id: string) => Promise<ProductPassportDocument>;
  readiness: (doc: Doc) => Promise<Array<{ label: string; key: string }>>;
  snapshot: (id: string) => Promise<unknown>;
  allocate: (set: Doc, date: Date, session?: ClientSession) => Promise<void>;
  assertFree: (set: Doc, selfId?: Types.ObjectId, session?: ClientSession) => Promise<void>;
}

/** Выпуск, аннулирование и поиск дублей паспортов (НМ, НМ-2); вызывается из ProductPassportService. */
export class PassportIssue {
  constructor(private readonly h: IssueHost) {}

  /**
   * НМ: выпуск — последний шаг. Проверка обязательного; текст собирается по справочникам и замораживается; номер паспорта,
   * номер изделия и талон — из счётчиков в ОДНОЙ транзакции со сменой статуса: повтор / двойной клик — тот же номер.
   */
  async issue(id: string) {
    const first = (await this.h.findById(id)).toObject() as unknown as Doc;
    assertNotExternal(first);
    if (isIssued(first)) return this.h.findById(id);
    if (first.status === 'annulled') throw new ConflictException('Паспорт аннулирован — выпустить нельзя');
    const missing = await this.h.readiness(first);
    if (missing.length) throw new BadRequestException({ message: `Не хватает для выпуска: ${missing.map((m) => m.label).join(', ')}`, missing });
    if (first.passportCategory) await this.h.snapshot(id); // текст по справочникам на момент выпуска
    const _id = new Types.ObjectId(id);
    const session = await this.h.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const draft = await this.h.model.findOne({ _id, status: 'draft' }).session(session).lean().exec();
        if (!draft) return; // уже выпущен параллельным запросом
        const set: Doc = {};
        await this.h.allocate(set, (draft.date as Date) || dayUtc(), session);
        await this.h.assertFree(set, _id, session);
        await this.h.model.updateOne({ _id, status: 'draft' }, { $set: { ...set, status: 'issued', issuedAt: new Date(), revision: 1 } }, { session }).exec();
      });
    } finally { await session.endSession(); }
    return this.h.findById(id);
  }

  /** НМ: аннулирование выпущенного — причина обязательна; номер остаётся занятым, повторно не выдаётся. */
  async annul(id: string, reason: unknown) {
    const r = String(reason ?? '').trim();
    if (!r) throw new BadRequestException('Укажите причину аннулирования');
    const doc = (await this.h.findById(id)).toObject() as unknown as Doc;
    if (!isIssued(doc)) throw new ConflictException(doc.status === 'annulled' ? 'Паспорт уже аннулирован' : 'Черновик не аннулируют — его можно удалить');
    await this.h.model.updateOne({ _id: doc._id }, { $set: { status: 'annulled', annulledAt: new Date(), annulReason: r } }).exec();
    return this.h.findById(id);
  }

  /**
   * НМ-2: «тот же изделие» — та же запись «Продукции»; дубль — её черновик, или выпущенный на тот же заказ / покупателя / адрес.
   */
  async duplicates(q: Record<string, unknown>) {
    if (!q.productId || !Types.ObjectId.isValid(String(q.productId))) return { items: [] };
    const productId = new Types.ObjectId(String(q.productId));
    const same: Doc[] = [];
    const s = (v: unknown) => String(v ?? '').trim();
    if (s(q.orderNo)) same.push({ orderNo: s(q.orderNo) });
    if (s(q.customer)) same.push({ customerName: new RegExp(`^\\s*${escapeRe(s(q.customer))}\\s*$`, 'i') });
    if (s(q.objectName)) same.push({ objectName: new RegExp(`^\\s*${escapeRe(s(q.objectName))}\\s*$`, 'i') });
    const docs = await this.h.model.find({ productId, deletedAt: null, ...(q.exceptId && Types.ObjectId.isValid(String(q.exceptId)) ? { _id: { $ne: new Types.ObjectId(String(q.exceptId)) } } : {}),
      $or: [{ status: 'draft' }, ...(same.length ? [{ status: { $ne: 'draft' }, $or: same }] : [])] }, { passportNumber: 1, status: 1, name: 1, customerName: 1, orderNo: 1, objectName: 1, date: 1 }).sort({ createdAt: -1 }).limit(10).lean().exec();
    return { items: docs.map((d) => ({ id: String(d._id), passportNumber: d.passportNumber && !isDraftNumber(d.passportNumber) ? d.passportNumber : null, status: d.status ?? 'issued', name: d.name, customerName: d.customerName ?? null, orderNo: d.orderNo ?? null, objectName: d.objectName ?? null, date: d.date ?? null })) };
  }
}
