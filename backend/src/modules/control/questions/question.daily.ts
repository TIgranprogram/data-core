import { AI_EXPIRE_DAYS, DAY } from './question.rules';
import { dupDictCandidates, dupPartnerCandidates, errorCandidates, fillCandidate, type ErrorTop, SOURCE_BATCH } from './question.sources';
import type { QuestionStore } from './question.store';
import type { Candidate } from './question.types';

export interface DailyDeps {
  fill: () => Promise<{ total: number; groups: Array<{ key: string; title: string; count: number }> }>;
  errorsTop: () => Promise<ErrorTop[]>;
}

export const LEASE_NOTE = 'Действие не завершилось: сервер перезапускался или связь прервалась. Проверьте данные и повторите вручную.';

/**
 * Часто и дёшево (раз в минуту): отложенные просыпаются, «ждёт помощника» возвращается человеку,
 * зависшее «выполняется» проверяется заново — проблема ушла значит сделано, иначе сбой.
 */
export async function runHousekeeping(st: QuestionStore, now: Date) {
  const col = st.questions();
  const out = { woke: 0, returned: 0, leases: 0 };
  for (const q of await col.find({ status: 'snoozed', snoozeUntil: { $lte: now } }).toArray()) {
    if ((await col.updateOne({ _id: q._id, status: 'snoozed' }, { $set: { status: 'open', snoozeUntil: null } })).matchedCount) { out.woke++; await st.log(q, 'woke', 'system', 'snoozed', 'open', 'Срок откладывания вышел', undefined, now); }
  }
  for (const q of await col.find({ status: 'waiting_agent', waitUntil: { $lte: now } }).toArray()) {
    if ((await col.updateOne({ _id: q._id, status: 'waiting_agent' }, { $set: { status: 'open', waitUntil: null } })).matchedCount) { out.returned++; await st.log(q, 'returned', 'system', 'waiting_agent', 'open', 'Помощник не ответил за неделю: вопрос вернулся человеку', undefined, now); }
  }
  for (const q of await col.find({ status: 'executing', 'exec.leaseUntil': { $lt: now } }).toArray()) {
    const re = await st.recheck(q);
    out.leases++;
    if (re && !re.still) await st.close(q, 'done', 'executed', 'system', 'Действие было выполнено (проверка после зависания)', { 'exec.state': 'done', 'exec.leaseUntil': null }, now).catch(() => undefined);
    else await st.close(q, 'failed', 'lease', 'system', LEASE_NOTE, { 'exec.state': 'failed', 'exec.leaseUntil': null, 'exec.error': LEASE_NOTE }, now).catch(() => undefined);
  }
  return out;
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

/** Раз в сутки (вместе со снимком дня): сбор → проверка → срок → истечение. Повтор в тот же день ничего не накручивает. */
export async function runDaily(st: QuestionStore, deps: DailyDeps, now: Date) {
  const res = { housekeeping: await runHousekeeping(st, now), collected: 0, created: 0, resolved: 0, expired: 0, escalated: 0 };
  const cands: Candidate[] = [];
  const fill = await safely(() => deps.fill(), null);
  const fc = fill && fillCandidate(fill);
  if (fc) cands.push(fc);
  cands.push(...(await safely(async () => errorCandidates(st.db, await deps.errorsTop(), now), [] as Candidate[])));
  cands.push(...(await safely(() => dupPartnerCandidates(st.db), [] as Candidate[])));
  cands.push(...(await safely(() => dupDictCandidates(st.db), [] as Candidate[])));
  for (const c of cands.slice(0, SOURCE_BATCH * 4)) {
    const r = await safely(() => st.upsert(c, now, { sameDayOnce: true }), null);
    if (r) { res.collected++; if (r.created) res.created++; }
  }

  const col = st.questions();
  for (const q of await col.find({ status: { $in: ['open', 'failed', 'waiting_agent', 'snoozed'] } }).toArray()) {
    const re = await st.recheck(q);
    if (re && !re.still) { await safely(() => st.close(q, 'resolved_auto', 'gone', 'system', 'Ночная проверка: проблемы больше нет', {}, now), undefined); res.resolved++; continue; }
    // ИИ-вопрос без ответа дольше месяца истекает сам; вопросы из данных сайта — никогда
    if (q.source.kind === 'ai' && q.status === 'open' && !q.decision && now.getTime() - q.seen.first.getTime() > AI_EXPIRE_DAYS * DAY) {
      await safely(() => st.close(q, 'expired', 'expired', 'system', `Без ответа больше ${AI_EXPIRE_DAYS} дней`, {}, now), undefined);
      res.expired++;
    }
  }
  res.escalated = await safely(() => st.escalateOverdue(now), 0);
  return res;
}
