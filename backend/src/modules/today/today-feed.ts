/** «Сегодня» — чистая сборка ленты дел и недели из готовых записей (без базы; тесты — today-feed.spec.ts). */

export type FeedKind = 'delivery' | 'shipment' | 'design' | 'question' | 'payment';
export type FeedTone = 'danger' | 'warn' | 'info';
export interface FeedAction { id: string; label: string }

/** Запись до расчёта срока: `due` — ГГГГ-ММ-ДД. */
export interface RawItem { kind: FeedKind; id: string; title: string; sub: string; due: string; actions: FeedAction[]; taskId?: string }
export interface FeedItem extends RawItem {
  tone: FeedTone;
  /** Только у просроченных. */
  overdueDays?: number;
  /** У сегодняшних и будущих (0 = сегодня). */
  daysLeft?: number;
}

/** За сколько дней до срока дело попадает в ленту (решение по СГД-1). */
export const FEED_WINDOW: Record<FeedKind, number> = { delivery: 1, shipment: 3, design: 2, question: 0, payment: 1 };

const DAY = 86400000;
export const dayNum = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** Тон: просрочено — danger, сегодня — warn, дальше — info. Вопрос без срока — всегда сегодня. */
function toneOf(left: number): FeedTone {
  return left < 0 ? 'danger' : left === 0 ? 'warn' : 'info';
}

const KIND_RANK: Record<FeedKind, number> = { delivery: 0, shipment: 1, design: 2, question: 3, payment: 4 };

/** Лента: только то, что в окне своего вида; сортировка — просрочено (дольше всех первым) → сегодня → завтра. */
export function buildFeed(items: RawItem[], today: string, limit = 30): { feed: FeedItem[]; total: number; all: FeedItem[] } {
  const t = dayNum(today);
  const out: FeedItem[] = [];
  for (const it of items) {
    const left = dayNum(it.due) - t;
    if (!Number.isFinite(left) || left > FEED_WINDOW[it.kind]) continue;
    out.push({ ...it, tone: toneOf(left), ...(left < 0 ? { overdueDays: -left } : { daysLeft: left }) });
  }
  // вопросы вам — всегда сверху: ждут ответа человека, а не даты
  out.sort((a, b) => Number(b.kind === 'question') - Number(a.kind === 'question') || a.due.localeCompare(b.due) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title, 'ru'));
  return { feed: out.slice(0, limit), total: out.length, all: out };
}

/** Неделя: по дню с `today` на `days` вперёд; просроченное и дальше окна не входит. */
export function buildWeek(items: Array<Pick<RawItem, 'kind' | 'id' | 'title' | 'due'>>, today: string, days: number) {
  const week = Array.from({ length: days }, (_, i) => ({ date: addDays(today, i), events: [] as Array<{ kind: FeedKind; id: string; title: string }> }));
  const by = new Map(week.map((d) => [d.date, d]));
  for (const it of items) by.get(it.due)?.events.push({ kind: it.kind, id: it.id, title: it.title });
  return week;
}

/** Числа «пульса дня» по уже собранной ленте. */
export function buildPulse(feed: FeedItem[]) {
  const n = (f: (x: FeedItem) => boolean) => feed.filter(f).length;
  return {
    overdue: n((x) => x.overdueDays !== undefined),
    dueToday: n((x) => x.daysLeft === 0),
    deliveriesToday: n((x) => x.kind === 'delivery' && (x.overdueDays !== undefined || x.daysLeft === 0)),
    shipmentsSoon: n((x) => x.kind === 'shipment'),
    questions: n((x) => x.kind === 'question'),
  };
}
