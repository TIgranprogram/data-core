import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { effectiveRoles } from '../../../common/roles-hierarchy';
import { AuditService } from '../../audit/audit.service';
import { ClientErrorsService } from '../../client-errors/client-errors.service';
import { DictsService } from '../../dicts/dicts.service';
import { FillAuditService } from '../../fill-audit/fill-audit.service';
import { PartnersService } from '../../partners/partners.service';
import type { AnswerDto, CreateQuestionDto, EventsQuery, PreviewDto, QuestionsQuery } from '../dto/questions.dto';
import { buildRegistry } from './question.kinds';
import type { ControlRegistry } from './question.registry';
import {
  AGENT_WAIT_DAYS, DAY, LEASE_SEC, NEW_PER_SOURCE_PER_DAY, OPEN_MAX, SNOOZE_MAX, checkParams, hashOf, plural, questionKey,
} from './question.rules';
import { runDaily, runHousekeeping } from './question.daily';
import { QuestionStore, UNDO_KEEP_DAYS, type UndoDoc } from './question.store';
import {
  ACTIVE_STATUSES, Q_STATUSES, type ActorInfo, type Candidate, type Severity, type Touched, type QuestionDoc, type QStatus,
} from './question.types';

const ObjectId = Types.ObjectId;
const SEVERITIES: Severity[] = ['low', 'medium', 'high'];
/** Какие ключи параметров клиент может передать (остальное отбрасываем). */
const PARAM_KEYS = ['fromId', 'intoId', 'dict', 'id', 'target'];
const ANSWERABLE: QStatus[] = ['open', 'failed', 'waiting_agent', 'snoozed'];

/** Понятный текст сбоя для человека (без стека и служебных слов). */
function humanError(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse() as string | { message?: string | string[] };
    const m = typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message;
    if (m) return String(m);
  }
  return 'Не удалось выполнить действие. Данные не изменены. Попробуйте позже или передайте разработчику.';
}

/** CC-14…16: «Разбор» — вопросы к человеку, предпросмотр, исполнение из реестра, откат. */
@Injectable()
export class QuestionsService implements OnModuleInit {
  readonly store: QuestionStore;
  readonly reg: ControlRegistry;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    partners: PartnersService,
    dicts: DictsService,
    @Optional() private readonly fill?: FillAuditService,
    @Optional() private readonly errors?: ClientErrorsService,
    @Optional() private readonly audit?: AuditService,
  ) {
    const db = connection.db!;
    this.reg = buildRegistry({ db, partners, dicts, fillSummary: async () => { const r = await this.fillReport(); return { total: r.total, keys: r.groups.map((g) => g.key) }; } });
    this.store = new QuestionStore(db, this.reg);
  }

  async onModuleInit() {
    try { await this.store.ensureIndexes(); } catch { /* индексы не помешают запуску: повтор при следующем старте */ }
  }

  async fillReport() {
    if (!this.fill) return { total: 0, groups: [] as Array<{ key: string; title: string; count: number }> };
    const r = await this.fill.report({ role: 'admin', isOwner: true }, { limit: 1 });
    return { total: r.total, groups: r.groups.map((g) => ({ key: g.key, title: g.title, count: g.count })) };
  }

  /** Раз в сутки (вместе со снимком дня): сбор от поставщиков, recheck, срок, истечение. */
  daily(now = new Date()) {
    return runDaily(this.store, {
      fill: () => this.fillReport(),
      errorsTop: async () => (this.errors ? (await this.errors.top('24')).items : []),
    }, now);
  }
  /** Часто и дёшево: пробуждение отложенных, возврат от помощника, зависшие исполнения. */
  housekeeping(now = new Date()) { return runHousekeeping(this.store, now); }

  // ─────────────────────────── чтение ───────────────────────────

  present(q: QuestionDoc, now = new Date()) {
    const { _id, exec, ...rest } = q;
    return {
      ...rest, id: String(_id),
      overdue: ACTIVE_STATUSES.includes(q.status) && q.dueAt.getTime() < now.getTime() && q.status !== 'snoozed' && q.status !== 'waiting_agent',
      canUndo: q.status === 'done' && !!exec?.undoId,
      exec: exec ? { state: exec.state, attempts: exec.attempts, error: exec.error ?? null } : undefined,
      options: q.options.map((o) => ({ ...o, needsPreview: !!o.actionId })),
    };
  }

  async list(q: QuestionsQuery) {
    const filter: Record<string, unknown> = {};
    if (q.status) {
      const st = q.status.split(',').map((x) => x.trim()).filter(Boolean);
      if (st.some((x) => !Q_STATUSES.includes(x as QStatus))) throw new BadRequestException('Статус указан неверно');
      filter.status = st.length === 1 ? st[0] : { $in: st };
    }
    if (q.severity) {
      if (!SEVERITIES.includes(q.severity as Severity)) throw new BadRequestException('Важность указана неверно');
      filter.severity = q.severity;
    }
    if (q.type) filter.type = q.type;
    const page = q.page ?? 1, limit = q.limit ?? 50;
    const col = this.store.questions();
    const [docs, total, byStatus] = await Promise.all([
      col.find(filter).sort({ severityRank: -1, dueAt: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      col.countDocuments(filter),
      col.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    ]);
    const now = new Date();
    return {
      items: docs.map((d) => this.present(d, now)), total, page, limit,
      counts: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
      types: this.reg.allTypes().map((t) => ({ type: t.type, title: t.title })),
    };
  }

  async get(id: string) { return this.present(await this.store.load(id)); }

  async events(id: string, q: EventsQuery) {
    const qd = await this.store.load(id);
    const page = q.page ?? 1, limit = q.limit ?? 100;
    const [docs, total] = await Promise.all([
      this.store.events().find({ questionId: qd._id }).sort({ at: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.store.events().countDocuments({ questionId: qd._id }),
    ]);
    return { items: docs.map(({ _id, questionId, ...e }) => ({ ...e, id: String(_id), questionId: String(questionId) })), total, page, limit };
  }

  // ─────────────────────────── постановка вопроса (CC-14, лимиты) ───────────────────────────

  /** POST /control/questions: вопрос от ИИ или скрипта. Тип и параметры проверяет сервер; лимиты — 20 в сутки на источник, 200 всего. */
  async create(dto: CreateQuestionDto, actor: ActorInfo, now = new Date()) {
    const def = this.reg.type(dto.type);
    if (!def || !def.external) throw new BadRequestException('Такого типа вопроса нет. Доступные: ' + this.reg.allTypes().filter((t) => t.external).map((t) => t.type).join(', '));
    const sourceName = (dto.sourceName ?? actor.name ?? 'помощник').trim().slice(0, 60) || 'помощник';
    const params: Record<string, unknown> = {};
    for (const k of PARAM_KEYS) if (typeof dto.params?.[k] === 'string') params[k] = String(dto.params[k]).slice(0, 200);

    let subject: { kind: string; ids: string[] };
    let what = (dto.what ?? '').trim(), need = (dto.need ?? '').trim();
    if (def.subjectFor) {
      subject = def.subjectFor(params);
      // кнопки типа — проверить параметры и убедиться, что действие вообще возможно сейчас
      for (const o of def.options({ subject, params })) {
        if (!o.actionId) continue;
        const act = this.reg.action(o.actionId)!;
        const pv = await act.preview(checkParams(act.paramsSchema, o.params));
        what = pv.lines[0];
        need = 'Посмотрите, что изменится, и подтвердите или откажитесь.';
      }
    } else {
      if (!what) throw new BadRequestException('Напишите вопрос (поле what)');
      const ids = (dto.subjectIds ?? []).map((x) => String(x).slice(0, 80));
      subject = { kind: 'text', ids: ids.length ? ids : [hashOf(what)] };
      need ||= 'Ответьте на вопрос текстом.';
    }
    const subjectIds = [...subject.ids].sort();
    const cand: Candidate = {
      type: dto.type, source: { kind: 'ai', name: sourceName, ...(dto.runId ? { runId: String(dto.runId).slice(0, 80) } : {}) },
      ...(dto.severity && SEVERITIES.includes(dto.severity) ? { severity: dto.severity } : {}),
      subject: { kind: subject.kind, ids: subjectIds }, params, what: what.slice(0, 600), need: need.slice(0, 600), advice: (dto.advice ?? '').trim().slice(0, 600),
      evidence: hashOf(subjectIds),
    };

    // Повтор уже открытого вопроса — не «новый»: лимиты его не касаются
    const key = questionKey(cand.type, cand.subject.kind, subjectIds, def.ruleV);
    const col = this.store.questions();
    if (!(await col.findOne({ key, active: true }, { projection: { _id: 1 } }))) {
      const since = new Date(now.getTime() - DAY);
      const [mine, open] = await Promise.all([
        col.countDocuments({ 'source.name': sourceName, type: { $ne: 'overflow' }, 'seen.first': { $gte: since } }),
        col.countDocuments({ active: true, type: { $ne: 'overflow' } }),
      ]);
      if (mine >= NEW_PER_SOURCE_PER_DAY || open >= OPEN_MAX) return this.overflow(sourceName, mine >= NEW_PER_SOURCE_PER_DAY, now);
    }
    const r = await this.store.upsert(cand, now);
    return { ...r, overflow: false };
  }

  /** Сверх лимита — один сводный вопрос на источник, счётчик растёт. */
  private async overflow(source: string, perSource: boolean, now: Date) {
    const text = (n: number) => `Источник «${source}» прислал больше вопросов, чем можно показать. Не показано: ${plural(n, ['вопрос', 'вопроса', 'вопросов'])}.`;
    const r = await this.store.upsert({
      type: 'overflow', source: { kind: 'system', name: 'Лимит вопросов' }, subject: { kind: 'source', ids: [source] },
      what: text(1),
      need: perSource ? `Источник может прислать не больше ${NEW_PER_SOURCE_PER_DAY} новых вопросов в сутки. Закройте ненужные вопросы — остальное он пришлёт позже.` : `Открытых вопросов уже ${OPEN_MAX}. Разберите или закройте ненужные — остальное придёт позже.`,
      advice: 'Начните с вопросов вверху списка: там самое важное и просроченное.',
      evidence: 'overflow',
    }, now, { patchOnBump: (n) => ({ what: text(n) }) });
    return { ...r, overflow: true };
  }

  // ─────────────────────────── предпросмотр ───────────────────────────

  private actionOf(q: QuestionDoc, code: string) {
    const opt = q.options.find((o) => o.code === code);
    if (!opt) throw new BadRequestException('У вопроса нет такого ответа');
    return { opt, act: opt.actionId ? this.reg.action(opt.actionId) : undefined };
  }

  private async buildPreview(q: QuestionDoc, code: string) {
    const { opt, act } = this.actionOf(q, code);
    if (!act) throw new BadRequestException('У этого ответа нет предпросмотра');
    const params = checkParams(act.paramsSchema, opt.params);
    const pv = await act.preview(params);
    return { opt, act, params, pv, planHash: hashOf(pv.plan) };
  }

  private previewBody(q: QuestionDoc, b: Awaited<ReturnType<QuestionsService['buildPreview']>>) {
    return { questionId: String(q._id), optionCode: b.opt.code, label: b.opt.label, risk: b.act.risk, reversible: b.act.risk === 'reversible', lines: b.pv.lines, planHash: b.planHash };
  }

  async preview(id: string, dto: PreviewDto) {
    const q = await this.store.load(id);
    if (!ANSWERABLE.includes(q.status)) throw new ConflictException('Вопрос уже закрыт или выполняется');
    const code = dto.optionCode ?? q.options.find((o) => o.actionId)?.code;
    if (!code) throw new BadRequestException('У этого вопроса нет действия с предпросмотром');
    return this.previewBody(q, await this.buildPreview(q, code));
  }

  // ─────────────────────────── ответ ───────────────────────────

  async answer(id: string, dto: AnswerDto, actor: ActorInfo, now = new Date()) {
    let q = await this.store.load(id);
    if (q.status === 'executing') throw new ConflictException('Действие уже выполняется: подождите несколько секунд');
    if (!ANSWERABLE.includes(q.status)) throw new ConflictException('Вопрос уже закрыт');
    const { opt, act } = this.actionOf(q, dto.optionCode);
    const by = actor.name || actor.id;
    const decision = (comment?: string) => ({ decision: { by, at: now, option: opt.code, ...(comment ? { comment: comment.slice(0, 600) } : {}) } });

    if (opt.link) return this.present(q); // переход в раздел — решает экран, записи не меняются

    if (opt.code === 'dismiss') {
      const re = await this.store.recheck(q); // запоминаем, какие данные человек счёл «не проблемой»
      await this.store.close(q, 'dismissed', 'not_a_problem', actor, dto.comment, { ...decision(dto.comment), ...(re?.evidence != null ? { evidenceHash: hashOf(re.evidence) } : {}) }, now);
    } else if (opt.code === 'snooze') {
      if (q.snoozeCount >= SNOOZE_MAX) throw new ConflictException(`Отложить можно не больше ${SNOOZE_MAX} раз. Решите вопрос или выберите «Не проблема»`);
      const until = dto.snoozeUntil ? new Date(dto.snoozeUntil) : null;
      if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) throw new BadRequestException('Укажите дату в будущем, до которой отложить');
      if (until.getTime() > now.getTime() + 90 * DAY) throw new BadRequestException('Отложить можно не дольше чем на 90 дней');
      const r = await this.store.questions().updateOne({ _id: q._id, status: q.status, snoozeCount: q.snoozeCount }, { $set: { status: 'snoozed', snoozeUntil: until, ...decision(dto.comment) }, $inc: { snoozeCount: 1 } });
      if (!r.matchedCount) throw new ConflictException('Вопрос уже изменён: обновите список');
      await this.store.log(q, 'snoozed', actor, q.status, 'snoozed', `До ${until.toISOString().slice(0, 10)}`, undefined, now);
    } else if (opt.code === 'to_agent') {
      const r = await this.store.questions().updateOne({ _id: q._id, status: q.status }, { $set: { status: 'waiting_agent', waitUntil: new Date(now.getTime() + AGENT_WAIT_DAYS * DAY), ...decision(dto.comment) } });
      if (!r.matchedCount) throw new ConflictException('Вопрос уже изменён: обновите список');
      await this.store.log(q, 'to_agent', actor, q.status, 'waiting_agent', `Ждём помощника ${AGENT_WAIT_DAYS} дней, потом вопрос вернётся`, undefined, now);
    } else if (opt.code === 'reply') {
      if (!dto.comment?.trim()) throw new BadRequestException('Напишите ответ');
      await this.store.close(q, 'done', 'answered', actor, dto.comment.slice(0, 600), decision(dto.comment), now);
    } else if (act) {
      return this.execute(q, opt.code, dto, actor, now);
    } else {
      throw new BadRequestException('Этот ответ пока не поддерживается');
    }
    q = await this.store.load(id);
    return this.present(q);
  }

  private async execute(q: QuestionDoc, code: string, dto: AnswerDto, actor: ActorInfo, now: Date) {
    const st = this.store;
    const { opt, act } = this.actionOf(q, code);
    if (!act) throw new BadRequestException('У этого ответа нет действия');
    if (!(actor.isOwner === true || effectiveRoles(actor.role).some((r) => act.roles.includes(r)))) throw new ForbiddenException('Это действие доступно администратору');

    // 1. проблема всё ещё есть? Нет — закрываем сами, ничего не пишем
    const re = await st.recheck(q);
    if (re && !re.still) {
      await st.close(q, 'resolved_auto', 'gone', 'system', 'Проверка перед действием: проблемы больше нет', {}, now);
      return this.present(await st.load(String(q._id)));
    }
    // 2. план строится заново; хеш другой — показываем новый предпросмотр
    if (!dto.planHash) throw new BadRequestException('Сначала посмотрите предпросмотр: что изменится');
    const b = await this.buildPreview(q, code);
    if (b.planHash !== dto.planHash) {
      throw new ConflictException({ statusCode: 409, message: 'Данные изменились с момента предпросмотра. Проверьте новый план и подтвердите ещё раз.', preview: this.previewBody(q, b) });
    }
    // 3. захват: двойное нажатие не пройдёт — статус меняет только один запрос
    const opId = new ObjectId().toHexString();
    const claim = await st.questions().updateOne(
      { _id: q._id, status: { $in: ANSWERABLE } },
      { $set: { status: 'executing', 'exec.state': 'running', 'exec.opId': opId, 'exec.leaseUntil': new Date(now.getTime() + LEASE_SEC * 1000), 'exec.error': null, 'exec.undoId': null }, $inc: { 'exec.attempts': 1 } },
    );
    if (!claim.matchedCount) throw new ConflictException('Действие уже выполняется или вопрос закрыт: обновите список');
    await st.log(q, 'executing', actor, q.status, 'executing', `${opt.label}: ${b.pv.lines[0] ?? ''}`, { planHash: b.planHash, opId }, now);

    // 4. снимок «до» → исполнение через существующий сервис → отпечаток «после»
    let undoId: Types.ObjectId | null = null;
    try {
      if (act.risk === 'reversible' && b.pv.touched?.length) undoId = await this.snapshot(q, act.id, b.pv.touched, now);
      const res = await act.execute(b.params, { opId, actor });
      if (undoId) await st.undo().updateOne({ _id: undoId }, { $set: { afterHash: await this.fingerprint(await this.readDocs(b.pv.touched!)) } });
      await st.questions().updateOne({ _id: q._id }, { $set: { status: 'done', active: false, closeReason: 'executed', 'exec.state': 'done', 'exec.leaseUntil': null, 'exec.undoId': undoId ? String(undoId) : null, decision: { by: actor.name || actor.id, at: now, option: code } } });
      await st.log(q, 'done', actor, 'executing', 'done', res.message, { planHash: b.planHash, opId, undoId: undoId ? String(undoId) : null }, now);
      await this.audit?.log({ action: 'control.executed', entityType: 'ControlQuestion', entityId: String(q._id), details: { meta: { action: act.id, params: b.params, opId } } });
    } catch (e) {
      if (undoId) await st.undo().deleteOne({ _id: undoId }).catch(() => undefined);
      const text = humanError(e);
      await st.questions().updateOne({ _id: q._id }, { $set: { status: 'failed', 'exec.state': 'failed', 'exec.leaseUntil': null, 'exec.error': text } });
      await st.log(q, 'failed', actor, 'executing', 'failed', text, { opId }, now);
    }
    return this.present(await st.load(String(q._id)));
  }

  // ─────────────────────────── снимки и откат ───────────────────────────

  private async readDocs(touched: Touched[]) {
    const out: Array<{ coll: string; doc: Record<string, unknown> }> = [];
    for (const t of touched) {
      const docs = await this.store.db.collection(t.coll).find({ _id: { $in: t.ids } }).toArray();
      for (const doc of docs) out.push({ coll: t.coll, doc: doc as Record<string, unknown> });
    }
    return out;
  }

  private fingerprint(docs: Array<{ coll: string; doc: Record<string, unknown> }>) {
    return hashOf(docs.map((d) => [d.coll, String(d.doc._id), d.doc]).sort((a, b) => (String(a[0]) + String(a[1]) < String(b[0]) + String(b[1]) ? -1 : 1)));
  }

  private async snapshot(q: QuestionDoc, actionId: string, touched: Touched[], now: Date) {
    const _id = new ObjectId();
    const row: UndoDoc = { _id, questionId: q._id, actionId, createdAt: now, keepUntil: new Date(now.getTime() + UNDO_KEEP_DAYS * DAY), docs: await this.readDocs(touched), afterHash: null, usedAt: null };
    await this.store.undo().insertOne(row);
    return _id;
  }

  /** Откат: возвращает снимок «до». Отказывает, если затронутые записи менялись после действия. */
  async undo(id: string, actor: ActorInfo, now = new Date()) {
    const st = this.store;
    const q = await st.load(id);
    if (q.status !== 'done' || !q.exec?.undoId) throw new ConflictException('Для этого вопроса отката нет');
    const u = await st.undo().findOne({ _id: new ObjectId(q.exec.undoId) });
    if (!u) throw new ConflictException('Снимок для отката уже удалён (хранится 90 дней)');
    if (u.usedAt) throw new ConflictException('Это действие уже отменено');
    const touched: Touched[] = [];
    for (const d of u.docs) {
      const t = touched.find((x) => x.coll === d.coll);
      if (t) t.ids.push(d.doc._id as Types.ObjectId); else touched.push({ coll: d.coll, ids: [d.doc._id as Types.ObjectId] });
    }
    if (this.fingerprint(await this.readDocs(touched)) !== u.afterHash) {
      throw new ConflictException('Отменить нельзя: после этого действия записи уже менялись. Чтобы не потерять новые правки, откат не выполнен.');
    }
    const lock = await st.undo().updateOne({ _id: u._id, usedAt: null }, { $set: { usedAt: now } });
    if (!lock.matchedCount) throw new ConflictException('Это действие уже отменено');
    try {
      for (const d of u.docs) await st.db.collection(d.coll).replaceOne({ _id: d.doc._id as Types.ObjectId }, d.doc);
    } catch (e) {
      await st.undo().updateOne({ _id: u._id }, { $set: { usedAt: null } });
      throw e;
    }
    const reopen = { status: 'open' as const, active: true, closeReason: null, 'exec.undoId': null };
    try {
      await st.questions().updateOne({ _id: q._id }, { $set: reopen });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      await st.questions().updateOne({ _id: q._id }, { $set: { closeReason: 'undone', 'exec.undoId': null } }); // такой вопрос уже поставлен заново
    }
    await st.log(q, 'undone', actor, 'done', 'open', 'Действие отменено, записи возвращены как были', { undoId: String(u._id) }, now);
    await this.audit?.log({ action: 'control.undone', entityType: 'ControlQuestion', entityId: String(q._id), details: { meta: { action: u.actionId } } });
    return this.present(await st.load(id));
  }
}
