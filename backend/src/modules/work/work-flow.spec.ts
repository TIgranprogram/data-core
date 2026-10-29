import { Types } from 'mongoose';
import { mergeColumns, nextIndex, planLaunch, positionAt } from './work-flow';
import { personWorkTypeIds, workTypeFields } from '../../common/catalog/person-work-types';

const step = (name: string) => ({ workTypeId: new Types.ObjectId(), name });

describe('work-flow', () => {
  it('положение карточки: ждёт / идёт шаг / готово', () => {
    const route = [step('Резка'), { workTypeId: null, name: 'Изготовление' }];
    expect(positionAt(route, null)).toEqual({ status: 'waiting', stepIndex: null, stepKey: '' });
    expect(positionAt(route, 0)).toMatchObject({ status: 'work', stepIndex: 0, stepKey: String(route[0].workTypeId) });
    expect(positionAt(route, 1).stepKey).toBe('generic');
    expect(positionAt(route, 2)).toEqual({ status: 'done', stepIndex: 2, stepKey: '' });
    expect([nextIndex(route, null), nextIndex(route, 0), nextIndex(route, 1), nextIndex(route, 2)]).toEqual([0, 1, 2, 2]);
  });

  it('колонки: порядок маршрутов сохраняется, общий вид работ не дублируется', () => {
    const k = (key: string) => ({ key, name: key });
    expect(mergeColumns([[k('резка'), k('сварка'), k('покраска')], [k('резка'), k('гибка'), k('сварка')], [k('сборка')]]).map((c) => c.key))
      .toEqual(['резка', 'гибка', 'сварка', 'покраска', 'сборка']);
    expect(mergeColumns([])).toEqual([]);
  });

  it('план запуска: причины отказа и общая работа', () => {
    const [l1, l2, l3, l4] = [1, 2, 3, 4].map((n) => ({ _id: new Types.ObjectId(), lineNo: n, title: `П${n}`, productId: n === 3 ? null : new Types.ObjectId() }));
    const p1 = { _id: l1.productId!, routeSteps: [step('Сварка')] }, p2 = { _id: l2.productId!, routeSteps: [] };
    const plan = planLaunch([l1, l2, l3, l4], new Map([[String(p1._id), p1], [String(p2._id), p2]]), new Map([[String(l1._id), 5]]));
    expect(plan.refused.map((r) => r.reason)).toEqual(['Уже в работе (W-5)', 'Нет изделия — сначала сопоставьте позицию с продукцией', 'Изделие не найдено или удалено — сопоставьте позицию заново']);
    expect(plan.launch.map((x) => x.generic)).toEqual([true]);
    expect(plan.warnings).toHaveLength(1);
  });

  it('виды работ сотрудника: новое поле, иначе старое; запись синхронна', () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    expect(personWorkTypeIds({ workTypeId: a })).toEqual([a]);
    expect(personWorkTypeIds({ workTypeIds: [b, a], workTypeId: a })).toEqual([b, a]);
    expect(personWorkTypeIds({})).toEqual([]);
    expect(workTypeFields([String(b), String(a), String(b), 'мусор'])).toEqual({ workTypeIds: [b, a], workTypeId: b });
    expect(workTypeFields([])).toEqual({ workTypeIds: null, workTypeId: null });
  });
});
