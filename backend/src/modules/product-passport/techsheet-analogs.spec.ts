import { rankAnalogs, topPhrases } from './techsheet-analogs';

const spec = (n: number) => ({ rows: Array.from({ length: n }, () => ({})) });

describe('C114: подсказки техописания из похожих изделий', () => {
  const self = { _id: 'a', name: 'Скамья на цепях', sku: '3201' };

  it('сначала то же первое слово, затем ближе по артикулу; без таблицы и само изделие не берутся', () => {
    const list = [
      { _id: 'a', name: 'Скамья на цепях', sku: '3201', materialsSpec: spec(3) },
      { _id: 'b', name: 'Урна', sku: '3202', materialsSpec: spec(2) },
      { _id: 'c', name: 'Скамья «Парк»', sku: '3290', materialsSpec: spec(1) },
      { _id: 'd', name: 'Скамья детская', sku: '3205', materialsSpec: spec(4) },
      { _id: 'e', name: 'Скамья пустая', sku: '3200', materialsSpec: { rows: [] } },
    ];
    expect(rankAnalogs(self, list).map((x) => x.id)).toEqual(['d', 'c', 'b']);
    expect(rankAnalogs(self, list)[0]).toMatchObject({ sku: '3205', name: 'Скамья детская', rows: 4 });
  });

  it('частые фразы группы: без пустых, без учёта регистра, по убыванию, только у 2+ изделий', () => {
    const list = [{ purpose: 'Отдых' }, { purpose: 'отдых ' }, { purpose: 'Игры' }, { purpose: '' }, {}];
    expect(topPhrases(list, 'purpose')).toEqual([{ value: 'Отдых', n: 2 }]); // «Игры» у одного изделия — не подсказка
    expect(topPhrases(list, 'purpose', 3, 1)).toEqual([{ value: 'Отдых', n: 2 }, { value: 'Игры', n: 1 }]);
  });
});
