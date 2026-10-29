import { areaOf, buildSessions, maskSecrets, parseSubject, placeOf, weekStart } from './devlog-calc';
import { DevlogService } from './devlog.service';
import { KIT_PATH_RE } from './dto/devlog.dto';

const at = (iso: string, hash = iso) => ({ hash, date: new Date(iso) });

describe('devlog-calc', () => {
  it('сессии: разрыв меньше 2 ч - одна сессия, часы = длина + 0,5', () => {
    const s = buildSessions([at('2026-10-20T10:00:00Z', 'a'), at('2026-10-20T11:30:00Z', 'b'), at('2026-10-20T13:29:00Z', 'c')]);
    expect(s).toHaveLength(1);
    expect(s[0].hours).toBe(3.98); // 3 ч 29 мин + 0,5
    expect(s[0].hashes).toEqual(['a', 'b', 'c']);
  });

  it('сессии: разрыв 2 ч и больше режет; одиночный коммит = 0,5 ч; порядок на входе не важен', () => {
    const s = buildSessions([at('2026-10-20T14:00:00Z', 'c'), at('2026-10-20T10:00:00Z', 'a'), at('2026-10-20T12:00:00Z', 'b')]);
    expect(s.map((x) => x.hashes)).toEqual([['a'], ['b'], ['c']]);
    expect(s.every((x) => x.hours === 0.5)).toBe(true);
  });

  it('сессия: место - по большинству эстафет', () => {
    const s = buildSessions([{ ...at('2026-10-20T10:00:00Z', 'a'), place: 'home' }, { ...at('2026-10-20T10:10:00Z', 'b'), place: 'home' }, { ...at('2026-10-20T10:20:00Z', 'c'), place: 'work' }]);
    expect(s[0].place).toBe('home');
  });

  it('разбор заголовка, раздел, место, неделя', () => {
    expect(parseSubject('feat(pwa): кнопка')).toEqual({ prefix: 'feat', scope: 'pwa', title: 'кнопка' });
    expect(parseSubject('просто текст')).toEqual({ title: 'просто текст' });
    expect(areaOf('Passports', [])).toBe('passports');
    expect(areaOf(undefined, ['docs/x.md', 'backend/src/modules/stock/a.ts'])).toBe('docs');
    expect(areaOf(undefined, ['backend/src/modules/stock/a.ts'])).toBe('stock');
    expect(placeOf('🏠 Продолжаю работать дома')).toBe('home');
    expect(placeOf('✅ Работа на работе закончена')).toBeUndefined();
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
  });

  it('секреты маскируются', () => {
    const m = maskSecrets('ключ kppd_AbC123-x и password: hunter2');
    expect(m).not.toContain('kppd_');
    expect(m).not.toContain('hunter2');
  });

  it('набор: только роли/процессы, не deploy и не секреты', () => {
    expect(KIT_PATH_RE.test('.claude/agents/backend.md')).toBe(true);
    expect(KIT_PATH_RE.test('.claude/skills/datacore-verify/SKILL.md')).toBe(true);
    expect(KIT_PATH_RE.test('deploy/synology/config.env')).toBe(false);
    expect(KIT_PATH_RE.test('.env')).toBe(false);
  });
});

/** Минимальная «коллекция» в памяти: find/bulkWrite (updateOne upsert)/countDocuments/deleteMany. */
class Coll {
  rows: Record<string, any>[] = [];
  constructor(private readonly keyField: string) {}
  private match(r: Record<string, any>, f: Record<string, any>) {
    return Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$in' in v ? v.$in.includes(r[k]) : r[k] === v));
  }
  find(f: Record<string, any> = {}) {
    const out = this.rows.filter((r) => this.match(r, f));
    const chain: any = { sort: () => chain, select: () => chain, lean: async () => out.map((r) => ({ ...r })) };
    return chain;
  }
  async countDocuments() { return this.rows.length; }
  async deleteMany(f: Record<string, any>) { this.rows = this.rows.filter((r) => !this.match(r, f)); }
  async bulkWrite(ops: any[]) {
    let upsertedCount = 0;
    for (const { updateOne: o } of ops) {
      let row: Record<string, any> = this.rows.find((r) => this.match(r, o.filter)) as Record<string, any>;
      if (!row) {
        if (!o.upsert) continue;
        row = { ...o.filter, ...(o.update.$setOnInsert ?? {}) };
        this.rows.push(row);
        upsertedCount++;
      }
      Object.assign(row, o.update.$set ?? {});
    }
    return { upsertedCount };
  }
}

function make(errors: any[] = []) {
  const m = { releases: new Coll('version'), commits: new Coll('hash'), sessions: new Coll('key'), items: new Coll('key'), docs: new Coll('path'), kit: new Coll('path') };
  const conn = { collection: () => ({ aggregate: () => ({ toArray: async () => errors }) }) };
  const service = new DevlogService(m.releases as never, m.commits as never, m.sessions as never, m.items as never, m.docs as never, m.kit as never, conn as never);
  return { service, m };
}

const dto = () => ({
  commits: [
    { hash: 'aaaaaaa', date: '2026-10-20T10:00:00+03:00', subject: 'feat(pwa): экран kppd_SECRET', footer: '🏠 дома', releaseVersion: 'v1.1' },
    { hash: 'bbbbbbb', date: '2026-10-20T10:30:00+03:00', subject: 'fix: ошибка', paths: ['backend/src/modules/stock/a.ts'] },
    { hash: 'ccccccc', date: '2026-10-20T20:00:00+03:00', subject: 'docs: заметка' },
  ],
  items: [{ key: 'task:1.1', type: 'task', title: 'Задача', status: 'done' }],
  docs: [{ path: 'docs/CHECKLIST-x.md', title: 'Чек-лист', kind: 'checklist', text: 'password=abc\n- [x] a' }],
  kit: [{ path: 'AGENTS.md', text: '# a' }],
  kitVersion: 'abcdef1',
});

describe('DevlogService.importAll', () => {
  it('повторный импорт не меняет число записей', async () => {
    const { service, m } = make();
    const first = await service.importAll(dto());
    const counts = () => Object.values(m).map((c) => c.rows.length);
    const before = counts();
    const second = await service.importAll(dto());
    expect(counts()).toEqual(before);
    expect(first).toMatchObject({ commits: 3, items: 1, docs: 1, kit: 1, sessions: 2, releases: 1 });
    expect(second).toMatchObject({ commits: 0, items: 0, docs: 0, kit: 0 });
  });

  it('раздел, место, сессия и версия заполнены; секреты не сохранены; sha256 - от исходного текста', async () => {
    const { service, m } = make();
    await service.importAll(dto());
    const a = m.commits.rows.find((r) => r.hash === 'aaaaaaa')!;
    expect(a).toMatchObject({ area: 'pwa', prefix: 'feat', place: 'home', day: '2026-10-20', releaseVersion: 'v1.1' });
    expect(m.commits.rows.find((r) => r.hash === 'bbbbbbb')!.area).toBe('stock');
    expect(m.commits.rows[0].sessionKey).toBe(m.commits.rows[1].sessionKey);
    expect(JSON.stringify(m.commits.rows)).not.toContain('kppd_');
    expect(m.docs.rows[0].text).not.toContain('abc');
    expect(m.docs.rows[0].sha256).toHaveLength(64);
  });

  it('ручные часы сессии и ручная запись не затираются повторным импортом', async () => {
    const { service, m } = make();
    await service.importAll(dto());
    m.sessions.rows[0].manualHours = 7;
    m.items.rows[0].manual = true;
    m.items.rows[0].title = 'Моя правка';
    const d = dto();
    d.items[0].title = 'Из файла';
    d.commits.push({ hash: 'ddddddd', date: '2026-10-20T10:40:00+03:00', subject: 'fix: ещё' } as never);
    await service.importAll(d);
    expect(m.sessions.rows.find((s) => s.manualHours === 7)).toBeTruthy();
    expect(m.items.rows[0].title).toBe('Моя правка');
  });

  it('ошибка после fixed возвращается в new («вернулась»)', async () => {
    const g = { _id: 'sig1', count: 2, firstAt: new Date('2026-10-01'), lastAt: new Date('2026-10-05'), message: 'boom', section: '#stock' };
    const { service, m } = make([g]);
    await service.importAll({ syncErrors: true });
    expect(m.items.rows[0]).toMatchObject({ key: 'err:sig1', status: 'new', count: 2 });
    m.items.rows[0].status = 'fixed';
    m.items.rows[0].closedAt = new Date('2026-10-06');
    g.lastAt = new Date('2026-10-10');
    await service.importAll({ syncErrors: true });
    expect(m.items.rows[0]).toMatchObject({ status: 'new', returned: true });
  });
});
