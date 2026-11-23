import { exerciseInstructions } from './exercise-instructions';
const block = { initialPosition: ' Сесть.\r\n\r\nВзяться за рукояти. ', movement: 'Двигать плавно.', muscles: 'Мышцы ног.' };
describe('C236 модельная инструкция', () => {
  it('нормализует только to, baseline сохраняет фактические строки', () => {
    expect(exerciseInstructions(block).initialPosition).toBe('Сесть.\n\nВзяться за рукояти.');
    expect(exerciseInstructions(block, true)).toEqual(block);
  });
  it.each([null, [], {}, { ...block, muscles: '' }, { ...block, movement: 1 }, { ...block, extra: '' }, { ...block, movement: '<b>Шаг</b>' }, { ...block, movement: '{name}' }, { ...block, movement: 'а'.repeat(4000) }])('отклоняет неподходящий блок %#', raw => {
    expect(() => exerciseInstructions(raw)).toThrow();
  });
  it('граница4000 без обрезания', () => {
    const input = { initialPosition: 'а', movement: 'б', muscles: 'в'.repeat(3998) };
    expect(exerciseInstructions(input)).toEqual(input);
  });
});
