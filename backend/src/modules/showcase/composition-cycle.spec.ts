import { wouldCycle } from './composition-cycle';

/** СИ: изделие не может входить само в себя — проверка по всей глубине. */
describe('wouldCycle — изделие внутри самого себя', () => {
  const g = new Map<string, string[]>([['B', ['C']], ['C', ['D']], ['D', []], ['E', ['A']]]);
  it('само в себя — сразу', () => expect(wouldCycle('A', ['A'], g)).toBe('A'));
  it('через цепочку на глубине: A ← B ← C ← D, а D содержит A', () => {
    const g2 = new Map(g); g2.set('D', ['A']);
    expect(wouldCycle('A', ['B'], g2)).toBe('B');
  });
  it('E содержит A — добавить E в A нельзя', () => expect(wouldCycle('A', ['E'], g)).toBe('E'));
  it('без цикла — null; общая ветка дважды не мешает', () => {
    const g3 = new Map(g); g3.set('X', ['D']); g3.set('Y', ['D']);
    expect(wouldCycle('A', ['B', 'X', 'Y'], g3)).toBeNull();
  });
  it('замкнутая чужая ветка без A не зацикливает проверку', () => {
    const g4 = new Map<string, string[]>([['P', ['Q']], ['Q', ['P']]]);
    expect(wouldCycle('A', ['P'], g4)).toBeNull();
  });
});
