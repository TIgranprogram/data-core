/** Чистые расчёты «Истории проекта»: разбор коммита, сессии, часы, очистка от секретов. */

export const SESSION_GAP_MS = 2 * 3600_000;
const SESSION_PAD_H = 0.5;

/** Секреты и ключи не попадают в базу: kppd_…, password=… */
export function maskSecrets(s: string): string {
  return s.replace(/kppd_[A-Za-z0-9_-]*/g, '***').replace(/(password|пароль)\s*[=:]\s*\S+/gi, '$1=***');
}

export function parseSubject(subject: string): { prefix?: string; scope?: string; title: string } {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.*)$/);
  return m ? { prefix: m[1].toLowerCase(), scope: m[2], title: m[3] } : { title: subject };
}

/** Раздел: скобка префикса; иначе по путям файлов (pwa, admin, модуль, docs). */
export function areaOf(scope: string | undefined, paths: string[] = []): string | undefined {
  if (scope) return scope.split(/[,/]/)[0].trim().toLowerCase();
  for (const p of paths) {
    if (p.startsWith('backend/pwa')) return 'pwa';
    if (p.startsWith('backend/admin')) return 'admin';
    const m = p.match(/^backend\/src\/modules\/([^/]+)/);
    if (m) return m[1];
    if (p.startsWith('backend/scripts')) return 'scripts';
    if (p.startsWith('docs/')) return 'docs';
  }
  return undefined;
}

/** Дом/работа — по эстафете последней строки тела коммита. */
export function placeOf(footer?: string): 'home' | 'work' | undefined {
  if (!footer) return undefined;
  if (footer.includes('🏠')) return 'home';
  if (footer.includes('🏢')) return 'work';
  return undefined;
}

export interface SessionCalc { key: string; start: Date; end: Date; hours: number; hashes: string[]; place?: 'home' | 'work' }

/** Коммиты с разрывом < 2 ч — одна сессия; часы = длина + 0,5 ч. Вход в любом порядке. */
export function buildSessions(commits: { hash: string; date: Date; place?: string }[]): SessionCalc[] {
  const sorted = [...commits].sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: SessionCalc[] = [];
  let cur: typeof sorted = [];
  const flush = () => {
    if (!cur.length) return;
    const start = cur[0].date, end = cur[cur.length - 1].date;
    const home = cur.filter((c) => c.place === 'home').length, work = cur.filter((c) => c.place === 'work').length;
    out.push({
      key: start.toISOString(), start, end, hashes: cur.map((c) => c.hash),
      hours: Math.round(((end.getTime() - start.getTime()) / 3600_000 + SESSION_PAD_H) * 100) / 100,
      place: home === work ? undefined : home > work ? 'home' : 'work',
    });
    cur = [];
  };
  for (const c of sorted) {
    if (cur.length && c.date.getTime() - cur[cur.length - 1].date.getTime() >= SESSION_GAP_MS) flush();
    cur.push(c);
  }
  flush();
  return out;
}

/** Понедельник недели для дня `ГГГГ-ММ-ДД`. */
export function weekStart(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
