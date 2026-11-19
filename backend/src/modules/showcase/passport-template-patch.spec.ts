import { Types } from 'mongoose';
import { parseTemplatePatch } from './passport-template-patch';

describe('Частичная правка шаблона паспорта C155', () => {
  const root = String(new Types.ObjectId());
  const partA = new Types.ObjectId(), partB = new Types.ObjectId();

  it('нормализует ссылки в BSON и сохраняет порядок деталей без дублей', () => {
    expect(parseTemplatePatch(
      { simpleDescription: { text: '  Каркас. ', partIds: [String(partB), String(partA), String(partB).toUpperCase()] } },
      { simpleDescription: null },
    )).toEqual({ to: { simpleDescription: { text: 'Каркас.', partIds: [partB, partA] } }, from: { simpleDescription: null } });
  });

  it('проверяет и передаёт отдельный корень текста и различает пустой список и снятие поля', () => {
    expect(parseTemplatePatch({
      textOverrides: { [root]: { text: 'На ровное основание.' } }, modules: [],
    }, {
      textOverrides: { [root]: null }, modules: null,
    })).toEqual({
      to: { ['textOverrides.' + root]: { text: 'На ровное основание.' }, modules: [] },
      from: { ['textOverrides.' + root]: null, modules: null },
    });
  });

  it.each([
    [{ $set: { passportCategory: 'BLG' } }, { $set: null }, '$set'],
    [{ simpleDescription: { text: ' ', partIds: [] } }, { simpleDescription: null }, 'simpleDescription.text'],
    [{ modules: [{ name: 'Рама', qty: 1, $set: {} }] }, { modules: null }, 'modules.$set'],
    [{ isKit: 'false' }, { isKit: null }, 'isKit'],
    [{ textChoices: { 'a.b': String(partA) } }, { textChoices: { 'a.b': null } }, 'textChoices'],
    [{ textOverrides: { [root]: { text: 'Своя фраза.', off: true } } }, { textOverrides: { [root]: null } }, 'textOverrides'],
    [{ elements: [] }, { joints: null }, 'совпадать'],
  ])('отвергает лишний или неверно заданный путь %#', (changes, expected, message) => {
    expect(() => parseTemplatePatch(changes, expected)).toThrow(message);
  });
});
