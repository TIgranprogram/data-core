import { candidateGroups, nameSimilarity, passportScore, type PassportModel } from './passport-models';

const m = (name: string, article: string, score = 1, n = 1): PassportModel => ({ key: name + '|' + article, name, article, n, score, bestId: name });

describe('изделия из паспортов: группы-кандидаты (БЗ-8)', () => {
  it('настоящие дубли (тот же артикул, похожее название, бренд не важен) — в одной группе, лучший первым', () => {
    const g = candidateGroups([m('Воркаут Турник тройной каскад «STREET IRON»', '3_4_2', 3, 5), m('Турник тройной каскад для воркаут', '3_4_2', 7, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0][0].name).toBe('Турник тройной каскад для воркаут');
  });

  it('один артикул — разные изделия: не склеиваются', () => {
    expect(candidateGroups([m('Уличный тренажёр - Жим от плеч «STREET IRON»', '7_38'), m('Жим от груди', '7_38')])).toEqual([]);
    expect(candidateGroups([m('Скамейка на 5 мест, сиденья - пластик. «STREET IRON»', '16_1'), m('Трибуна на 5 мест', '16_1')])).toEqual([]);
    expect(candidateGroups([m('Пергола 8', '19_2'), m('Пергола Pimko', '19_2')])).toEqual([]);
  });

  it('одинаковое название с разным артикулом — кандидат; совсем разные — нет', () => {
    expect(candidateGroups([m('Стойка баскетбольная «Г» образная, вынос 1,2м', '1_4'), m('Стойка баскетбольная Г-образная вынос 1,2м', '')])).toHaveLength(1);
    expect(candidateGroups([m('Качели на цепочках', ''), m('Карусель', '')])).toEqual([]);
  });

  it('похожесть и полнота', () => {
    expect(nameSimilarity('Турник «STREET IRON»', 'турник')).toBe(1);
    expect(nameSimilarity('', 'турник')).toBe(0);
    expect(passportScore({ height: 1, width: 2, elements: ['a'], images: [1, 2, 3, 4, 5] })).toBe(2 + 2 + 4);
  });
});
