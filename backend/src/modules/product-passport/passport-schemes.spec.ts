import { standardSchemes } from './passport-schemes';

/** Стандартные схемы узлов из способа установки (БЗ-6 Э9.5). */
describe('standardSchemes', () => {
  const install = { schemesFoundation: ['f1', 'f2'], schemesHoles: ['h1'], schemesMounting: [] };
  it('своих схем нет — берутся все стандартные по видам', () => {
    expect(standardSchemes({ images: [{ kind: 'overview' }] }, install).map((x) => `${x.kind}:${x.photoId}`)).toEqual(['foundation:f1', 'foundation:f2', 'holes:h1']);
  });
  it('своя схема вида заменяет стандартные этого вида', () => {
    expect(standardSchemes({ images: [{ kind: 'foundation' }] }, install).map((x) => x.kind)).toEqual(['holes']);
  });
  it('«только свои» или нет способа установки — ничего', () => {
    expect(standardSchemes({ schemeSource: 'own' }, install)).toEqual([]);
    expect(standardSchemes({}, null)).toEqual([]);
  });
});
