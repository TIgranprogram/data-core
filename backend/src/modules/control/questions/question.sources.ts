import type { mongo } from 'mongoose';
import { DICTS } from '../../dicts/dicts.defs';
import { hashOf, normName, plural } from './question.rules';
import type { Candidate } from './question.types';

type Db = mongo.Db;
const SYSTEM = (name: string) => ({ kind: 'system' as const, name });
/** Не больше стольких вопросов одного вида за один сбор: остальные подтянутся, когда эти закроют. */
export const SOURCE_BATCH = 30;

/** CC-16: итог «Требуют заполнения» — один сводный вопрос, а не по вопросу на каждую запись. */
export function fillCandidate(s: { total: number; groups: Array<{ key: string; title: string; count: number }> }): Candidate | null {
  if (s.total <= 0) return null;
  const top = [...s.groups].sort((a, b) => b.count - a.count)[0];
  return {
    type: 'fill_audit', source: SYSTEM('Проверка заполнения'), subject: { kind: 'fill-audit', ids: ['all'] },
    what: `Не заполнено: ${plural(s.total, ['запись', 'записи', 'записей'])} в ${plural(s.groups.length, ['группе', 'группах', 'группах'])}.`,
    need: 'Откройте «Требуют заполнения» и впишите недостающее. Группа исчезает сама, когда всё заполнено.',
    advice: top ? `Начните с самой большой группы: «${top.title}» — ${top.count}.` : 'Начните с самой большой группы.',
    evidence: hashOf(s.groups.map((g) => g.key).sort()),
  };
}

export interface ErrorTop { sig: string; count: number; users: number; message: string; section?: string }

/** CC-16: новые ошибки сайта. Новая = такой сигнатуры не было раньше суток. */
export async function errorCandidates(db: Db, top: ErrorTop[], now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - 86_400_000);
  const out: Candidate[] = [];
  for (const e of top) {
    if (out.length >= SOURCE_BATCH) break;
    if (await db.collection('clienterrors').countDocuments({ sig: e.sig, createdAt: { $lt: since } }, { limit: 1 })) continue;
    const msg = String(e.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    out.push({
      type: 'client_error', source: SYSTEM('Ошибки сайта'), subject: { kind: 'client-error', ids: [e.sig] },
      what: `В приложении появилась новая ошибка: «${msg || 'без текста'}»${e.section ? ` (раздел «${e.section}»)` : ''}. Её увидели: ${plural(e.users, ['человек', 'человека', 'человек'])}, ${plural(e.count, ['раз', 'раза', 'раз'])}.`,
      need: 'Повторите действие в этом разделе и посмотрите, мешает ли ошибка работе. Если мешает — передайте разработчику, что делали перед ошибкой.',
      advice: 'Если ошибка не мешает работе, выберите «Не проблема»: вопрос вернётся, только если появится другая ошибка.',
      evidence: e.sig,
    });
  }
  return out;
}

interface Row { _id: unknown; name: string }

function groupDups(rows: Row[]): string[][] {
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const k = normName(r.name);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), String(r._id)]);
  }
  return [...by.values()].filter((g) => g.length >= 2).map((g) => g.sort());
}

/** CC-16: дубли контрагентов — полное совпадение названия без учёта регистра и пробелов, без нечёткого поиска. */
export async function dupPartnerCandidates(db: Db): Promise<Candidate[]> {
  const rows = await db.collection('organizations').find({ deletedAt: null, isOurCompany: { $ne: true } }, { projection: { name: 1 } }).toArray();
  return groupDups(rows.map((r) => ({ _id: r._id, name: String(r.name ?? '') }))).slice(0, SOURCE_BATCH).map((ids) => {
    const name = String(rows.find((r) => String(r._id) === ids[0])?.name ?? '');
    return {
      type: 'dup_partners', source: SYSTEM('Поиск дублей'), subject: { kind: 'partner', ids },
      what: `В контрагентах ${plural(ids.length, ['карточка', 'карточки', 'карточек'])} с названием «${name}» — похоже на дубль.`,
      need: 'Откройте контрагентов и решите, одна это компания или разные. Если одна — объедините карточки.',
      advice: 'Объединять лучше в карточке: там видно, какие заявки и счета перейдут.',
      evidence: hashOf(ids),
    };
  });
}

/** CC-16: повторы значений в справочниках — то же правило полного совпадения. */
export async function dupDictCandidates(db: Db): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const def of DICTS) {
    if (out.length >= SOURCE_BATCH) break;
    const docs = await db.collection(def.coll).find(def.match as never).toArray();
    for (const ids of groupDups(docs.map((x) => ({ _id: x._id, name: def.name(x as never) })))) {
      if (out.length >= SOURCE_BATCH) break;
      const name = def.name(docs.find((x) => String(x._id) === ids[0]) as never);
      out.push({
        type: 'dup_dicts', source: SYSTEM('Поиск дублей'), subject: { kind: `dict:${def.key}`, ids },
        what: `В справочнике «${def.title}» ${plural(ids.length, ['значение', 'значения', 'значений'])} «${name}» — повтор.`,
        need: 'Откройте справочник и объедините повторы в одно значение: записи, где оно используется, перейдут к оставленному.',
        advice: 'Оставляйте то значение, которое уже используется чаще.',
        evidence: hashOf(ids),
      });
    }
  }
  return out;
}
