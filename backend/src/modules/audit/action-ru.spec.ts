import { actionRu } from './action-ru';

describe('actionRu', () => {
  it('суффикс + сущность', () => {
    expect(actionRu('update', 'SupplyRequest')).toBe('Заявка: изменено');
    expect(actionRu('income.created', 'Income')).toBe('Позиция заказа: создано');
    expect(actionRu('salesorder.deleted', 'SalesOrder')).toBe('Заказ: удалено');
    expect(actionRu('restored', 'SalesOrder')).toBe('Заказ: восстановлено');
  });
  it('без известной сущности — глагол; неизвестное — код', () => {
    expect(actionRu('created', 'Xyz')).toBe('Создано');
    expect(actionRu('dict.merged', 'DictItem')).toBe('dict.merged');
  });
});
