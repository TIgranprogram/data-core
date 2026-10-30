import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
const ObjectId = Types.ObjectId;
type ObjectId = Types.ObjectId;
import type { mongo } from 'mongoose';
import { ymd } from '../control.rollup';
import type { ControlRegistry } from './question.registry';
import { DAY, DISMISS_OPTION, SNOOZE_OPTION, bumpSeverity, hashOf, questionKey, severityRank } from './question.rules';
import type { ActorInfo, Candidate, EventDoc, QOption, QStatus, QuestionDoc, RecheckResult } from './question.types';
import { isActiveStatus } from './question.types';

type Db = mongo.Db;
export const COL_QUESTIONS = 'app_control_questions';
export const COL_EVENTS = 'app_control_events';
export const COL_UNDO = 'app_control_undo';
/** Снимки для отката живут 90 дней. */
export const UNDO_KEEP_DAYS = 90;

export interface UndoDoc {
  _id: ObjectId;
  questionId: ObjectId;
  actionId: string;
  createdAt: Date;
  keepUntil: Date;
  docs: Array<{ coll: string; doc: Record<string, unknown> }>;
  afterHash: string | null;
  usedAt: Date | null;
}

export const actorName = (a: ActorInfo | 'system') => (a === 'system' ? 'система' : a.name || a.id);

/** Доступ к трём коллекциям «Разбора» и общие операции над вопросом. Мягкого удаления и аудита здесь нет — только драйвер. */
export class QuestionStore {
  constructor(readonly db: Db, readonly reg: ControlRegistry) {}

  questions() { return this.db.collection<QuestionDoc>(COL_QUESTIONS); }
  events() { return this.db.collection<EventDoc>(COL_EVENTS); }
  undo() { return this.db.collection<UndoDoc>(COL_UNDO); }

  async ensureIndexes() {
    const q = this.questions();
    // $in в частичном индексе 4.4 нельзя — поэтому флаг active
    await q.createIndex({ key: 1 }, { unique: true, partialFilterExpression: { active: true } });
    await q.createIndex({ status: 1, severity: 1 });
    await q.createIndex({ dueAt: 1 });
    await this.events().createIndex({ questionId: 1, at: 1 });
    await this.undo().createIndex({ keepUntil: 1 }, { expireAfterSeconds: 0 });
  }

  async log(q: Pick<QuestionDoc, '_id'>, kind: string, by: ActorInfo | 'system', before?: string, after?: string, note?: string, data?: Record<string, unknown>, now = new Date()) {
    await this.events().insertOne({ _id: new ObjectId(), questionId: q._id, at: now, by: actorName(by), kind, ...(before ? { before } : {}), ...(after ? { after } : {}), ...(note ? { note } : {}), ...(data ? { data } : {}) });
  }

  async load(id: string): Promise<QuestionDoc> {
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException('Вопрос не найден');
    const q = await this.questions().findOne({ _id: new ObjectId(id) });
    if (!q) throw new NotFoundException('Вопрос не найден');
    return q;
  }

  /** Все кнопки вопроса: кнопки типа + «Не проблема» + «Отложить до даты». */
  optionsFor(type: string, subject: QuestionDoc['subject'], params?: Record<string, unknown>): QOption[] {
    const def = this.reg.type(type);
    return [...(def?.options({ subject, params }) ?? []), DISMISS_OPTION, SNOOZE_OPTION];
  }

  /** Проверка «проблема ещё есть?». Сбой проверки = неизвестно (null), вопрос не закрываем. */
  async recheck(q: QuestionDoc): Promise<RecheckResult | null> {
    try { return (await this.reg.type(q.type)?.recheck(q)) ?? null; } catch { return null; }
  }

  async close(q: QuestionDoc, status: QStatus, closeReason: string, by: ActorInfo | 'system', note?: string, extra: Record<string, unknown> = {}, now = new Date()) {
    const r = await this.questions().updateOne({ _id: q._id, status: q.status }, { $set: { status, active: isActiveStatus(status), closeReason, ...extra } });
    if (!r.matchedCount) throw new ConflictException('Вопрос уже изменён другим действием: обновите список');
    await this.log(q, status, by, q.status, status, note, undefined, now);
  }

  /**
   * Поставщик нашёл проблему. Правила: вопрос с тем же ключом уже открыт — только count++ и seen.last;
   * «Не проблема» с теми же данными — молчим; данные изменились — вопрос возвращается.
   * `sameDayOnce`: сбор раз в сутки не накручивает счётчик, если сегодня этот вопрос уже видели.
   */
  async upsert(c: Candidate, now: Date, opts: { sameDayOnce?: boolean; patchOnBump?: (n: number) => Record<string, unknown> } = {}): Promise<{ id: string; created: boolean }> {
    const def = this.reg.type(c.type)!;
    const subject = { kind: c.subject.kind, ids: [...c.subject.ids].map(String).sort() };
    const key = questionKey(c.type, subject.kind, subject.ids, def.ruleV);
    const evidenceHash = hashOf(c.evidence);
    const col = this.questions();

    const bump = async (q: QuestionDoc, reopen = false) => {
      const same = opts.sameDayOnce && ymd(q.seen.last) === ymd(now) && !reopen;
      const set: Record<string, unknown> = { 'seen.last': now };
      if (reopen) Object.assign(set, { status: 'open', active: true, evidenceHash, dueAt: new Date(now.getTime() + def.dueDays * DAY), escalated: false, severity: c.severity ?? def.severity, severityRank: severityRank(c.severity ?? def.severity), what: c.what, need: c.need, advice: c.advice, closeReason: null, snoozeUntil: null });
      const count = q.seen.count + (same ? 0 : 1);
      Object.assign(set, same ? {} : { 'seen.count': count }, opts.patchOnBump?.(count) ?? {});
      await col.updateOne({ _id: q._id }, { $set: set });
      if (reopen) await this.log(q, 'reopened', 'system', q.status, 'open', 'Данные изменились после «Не проблема»', undefined, now);
      return { id: String(q._id), created: false };
    };

    const live = await col.findOne({ key, active: true });
    if (live) return bump(live);
    const last = await col.findOne({ key, active: false }, { sort: { 'seen.last': -1 } });
    if (last?.status === 'dismissed') {
      if (last.evidenceHash === evidenceHash) return bump(last); // «Не проблема» остаётся в силе: данные те же
      try { return await bump(last, true); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
      const again = await col.findOne({ key, active: true });
      if (again) return bump(again);
    }
    const severity = c.severity ?? def.severity;
    const doc: QuestionDoc = {
      _id: new ObjectId(), key, active: true, type: c.type, source: c.source, severity, severityRank: severityRank(severity),
      subject, ...(c.params ? { params: c.params } : {}), what: c.what, need: c.need, advice: c.advice,
      options: this.optionsFor(c.type, subject, c.params), evidenceHash,
      seen: { first: now, last: now, count: 1 }, status: 'open', dueAt: new Date(now.getTime() + def.dueDays * DAY), snoozeCount: 0,
    };
    try {
      await col.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const raced = await col.findOne({ key, active: true });
      if (raced) return bump(raced);
      throw e;
    }
    await this.log(doc, 'created', 'system', undefined, 'open', `Источник: ${c.source.name}`, undefined, now);
    return { id: String(doc._id), created: true };
  }

  /** Срок вышел — важность на ступень выше (один раз). */
  async escalateOverdue(now: Date): Promise<number> {
    const rows = await this.questions().find({ active: true, status: { $in: ['open', 'failed'] }, dueAt: { $lt: now }, escalated: { $ne: true } }).toArray();
    for (const q of rows) {
      const sev = bumpSeverity(q.severity);
      await this.questions().updateOne({ _id: q._id }, { $set: { severity: sev, severityRank: severityRank(sev) + 0.5, escalated: true } });
      await this.log(q, 'escalated', 'system', undefined, undefined, 'Срок вышел: вопрос поднят выше', undefined, now);
    }
    return rows.length;
  }
}
