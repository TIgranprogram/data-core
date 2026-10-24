import { RECORD_HISTORY_TYPES, RECORD_TYPE_SECTIONS, historyTypesFor } from './audit.controller';
import { setRoleSectionsAll } from '../../common/app-sections';

/** SK-8d: история приложения — только типы записей открытых разделов роли. */
describe('historyTypesFor', () => {
  beforeAll(() => setRoleSectionsAll([{ name: 'r-kl', appSections: ['stock', 'requests'] }]));
  afterAll(() => setRoleSectionsAll([]));

  it('у каждого типа истории есть разделы', () => {
    for (const t of RECORD_HISTORY_TYPES) expect(RECORD_TYPE_SECTIONS[t]).toBeDefined();
  });

  it('без ограничений — все типы', () => {
    expect(historyTypesFor({ role: 'manager' })).toEqual(RECORD_HISTORY_TYPES);
    expect(historyTypesFor({ role: 'admin' })).toEqual(RECORD_HISTORY_TYPES);
  });

  it('кладовщик: заявки, склад и справочники', () => {
    expect(historyTypesFor({ role: 'r-kl' })).toEqual(['SupplyRequest', 'Material', 'StockMovement', 'DictItem']);
  });
});
