import { addDays, buildFeed, buildPulse, buildWeek, type RawItem } from './today-feed';

const T = '2026-10-28';
const mk = (kind: RawItem['kind'], id: string, due: string, title = id): RawItem => ({ kind, id, title, sub: '', due, actions: [] });

describe('today-feed', () => {
  it('сортирует: просрочено → сегодня → завтра, считает дни и тон', () => {
    const { feed } = buildFeed([mk('delivery', 'c', '2026-10-29'), mk('delivery', 'b', T), mk('delivery', 'a', '2026-10-25')], T);
    expect(feed.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(feed[0]).toMatchObject({ tone: 'danger', overdueDays: 3 });
    expect(feed[1]).toMatchObject({ tone: 'warn', daysLeft: 0 });
    expect(feed[2]).toMatchObject({ tone: 'info', daysLeft: 1 });
    expect(feed[1].overdueDays).toBeUndefined();
  });

  it('окна: отгрузка 3 дня, дизайн 2, поставка 1', () => {
    const { feed, total } = buildFeed([
      mk('shipment', 's3', addDays(T, 3)), mk('shipment', 's4', addDays(T, 4)),
      mk('design', 'd2', addDays(T, 2)), mk('design', 'd3', addDays(T, 3)),
      mk('delivery', 'p2', addDays(T, 2)),
    ], T);
    expect(feed.map((x) => x.id).sort()).toEqual(['d2', 's3']);
    expect(total).toBe(2);
  });

  it('лимит ленты, total — полное число', () => {
    const many = Array.from({ length: 5 }, (_, i) => mk('delivery', 'x' + i, T));
    const r = buildFeed(many, T, 3);
    expect(r.feed).toHaveLength(3);
    expect(r.total).toBe(5);
  });

  it('неделя: события по дням, чужие даты отбрасываются', () => {
    const w = buildWeek([mk('delivery', 'a', T), mk('shipment', 'b', addDays(T, 6)), mk('shipment', 'c', addDays(T, 7)), mk('delivery', 'o', '2026-10-01')], T, 7);
    expect(w).toHaveLength(7);
    expect(w[0].events.map((e) => e.id)).toEqual(['a']);
    expect(w[6].events.map((e) => e.id)).toEqual(['b']);
  });

  it('пульс считает просроченное, сегодняшнее и вопросы', () => {
    const { feed } = buildFeed([mk('delivery', 'a', '2026-10-20'), mk('delivery', 'b', T), mk('shipment', 's', addDays(T, 2)), mk('question', 'q', T)], T);
    expect(buildPulse(feed)).toEqual({ overdue: 1, dueToday: 2, deliveriesToday: 2, shipmentsSoon: 1, questions: 1 });
  });
});
