import type { Types } from 'mongoose';
type ObjectId = Types.ObjectId;

/** CC-14: «Разбор» — вопросы, на которые отвечает человек. Жизненный цикл: open → executing → done и другие исходы. */
export type QStatus = 'open' | 'executing' | 'done' | 'failed' | 'waiting_agent' | 'snoozed' | 'dismissed' | 'resolved_auto' | 'expired';
export const Q_STATUSES: readonly QStatus[] = ['open', 'executing', 'done', 'failed', 'waiting_agent', 'snoozed', 'dismissed', 'resolved_auto', 'expired'];
/** Вопрос ещё жив (занимает ключ в уникальном индексе). */
export const ACTIVE_STATUSES: readonly QStatus[] = ['open', 'executing', 'failed', 'waiting_agent', 'snoozed'];
/** Вопрос ждёт человека (считается в показателях «открытые», «просроченные»). */
export const HUMAN_STATUSES: readonly QStatus[] = ['open', 'failed'];
export const isActiveStatus = (s: QStatus) => ACTIVE_STATUSES.includes(s);

export type Severity = 'low' | 'medium' | 'high';
export const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high'];
/** reversible — есть снимок, откат кнопкой; irreversible — отменить нельзя (в экране красным). */
export type Risk = 'safe' | 'reversible' | 'irreversible';

export interface QOption {
  code: string;
  label: string;
  actionId?: string;
  params?: Record<string, unknown>;
  risk: Risk;
  /** Переход в раздел приложения вместо действия (экран открывает его сам). */
  link?: { section: string; id?: string };
}

export interface QuestionDoc {
  _id: ObjectId;
  key: string;
  active: boolean;
  type: string;
  source: { kind: 'system' | 'ai' | 'script'; name: string; runId?: string };
  severity: Severity;
  severityRank: number;
  escalated?: boolean;
  subject: { kind: string; ids: string[] };
  /** Параметры типа (для recheck и действий) — только то, что проверил сервер. */
  params?: Record<string, unknown>;
  what: string;
  need: string;
  advice: string;
  options: QOption[];
  evidenceHash: string;
  seen: { first: Date; last: Date; count: number };
  status: QStatus;
  dueAt: Date;
  snoozeUntil?: Date | null;
  snoozeCount: number;
  waitUntil?: Date | null;
  decision?: { by: string; at: Date; option: string; comment?: string };
  exec?: { state: 'running' | 'done' | 'failed'; opId: string; leaseUntil: Date | null; attempts: number; error?: string | null; undoId?: string | null };
  closeReason?: string | null;
}

export interface EventDoc {
  _id: ObjectId;
  questionId: ObjectId;
  at: Date;
  by: string;
  kind: string;
  before?: string;
  after?: string;
  note?: string;
  data?: Record<string, unknown>;
}

/** Что действие меняет: коллекция и id документов (для снимка «до» и отката). */
export interface Touched { coll: string; ids: ObjectId[] }

export interface PreviewResult {
  lines: string[];
  /** Всё, от чего зависит исход; хеш плана считается от него. */
  plan: unknown;
  touched?: Touched[];
}

export interface ActorInfo { id: string; role?: string; name?: string; isOwner?: boolean }

export interface ExecResult { message: string }

/** Тип схемы параметра действия: проверяет сервер, клиент параметров не присылает. */
export type ParamKind = 'oid' | 'string';

export interface ActionDef {
  id: string;
  paramsSchema: Record<string, ParamKind>;
  roles: string[];
  risk: Risk;
  preview(params: Record<string, unknown>): Promise<PreviewResult>;
  execute(params: Record<string, unknown>, ctx: { opId: string; actor: ActorInfo }): Promise<ExecResult>;
}

export interface RecheckResult { still: boolean; evidence?: string }

/** Описание нового вопроса от поставщика или из POST. */
export interface Candidate {
  type: string;
  source: QuestionDoc['source'];
  severity?: Severity;
  subject: { kind: string; ids: string[] };
  params?: Record<string, unknown>;
  what: string;
  need: string;
  advice: string;
  evidence: string;
}

export interface TypeDef {
  type: string;
  title: string;
  /** Версия правила: меняется смысл проверки — ключ другой, старые вопросы не мешают. */
  ruleV: number;
  dueDays: number;
  severity: Severity;
  roles: string[];
  /** ИИ или скрипт могут прислать вопрос этого типа через POST. */
  external: boolean;
  /** Проверка «проблема ещё есть?». Без неё тип не регистрируется. */
  recheck(q: Pick<QuestionDoc, 'subject' | 'params' | 'type'>): Promise<RecheckResult>;
  /** Тип можно прислать через POST: тема вопроса строится из проверенных параметров, а не со слов клиента. */
  subjectFor?(params: Record<string, unknown>): { kind: string; ids: string[] };
  /** Кнопки типа; «Не проблема» и «Отложить» добавляет сервер. */
  options(q: Pick<QuestionDoc, 'subject' | 'params'>): QOption[];
}
