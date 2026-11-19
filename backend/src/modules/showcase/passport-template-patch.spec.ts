import { Types } from 'mongoose';
import { patchPassportTemplate, parseTemplatePatch } from './passport-template-patch';
import { presentPassportDefaults } from './passport-defaults';

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
    [{ facetValueIds: ['bad'] }, { facetValueIds: null }, 'facetValueIds'],
    [{ facetValueIds: {} }, { facetValueIds: null }, 'facetValueIds'],
    [{ 'product.facetValueIds': [] }, { 'product.facetValueIds': null }, 'product.facetValueIds'],
  ])('отвергает лишний или неверно заданный путь %#', (changes, expected, message) => {
    expect(() => parseTemplatePatch(changes, expected)).toThrow(message);
  });
});

describe('C163: критерии самого изделия', () => {
  const value = new Types.ObjectId(), parent = new Types.ObjectId(), productId = new Types.ObjectId();
  it('нормализует новые ссылки без дублей, прежний порядок и дубли остаются точным CAS', () => {
    expect(parseTemplatePatch({ facetValueIds: [String(value), String(value).toUpperCase()] },
      { facetValueIds: [String(value), String(value)] })).toEqual({ to: { facetValueIds: [value] }, from: { facetValueIds: [value, value] } });
    expect(parseTemplatePatch({ facetValueIds: [] }, { facetValueIds: null })).toEqual({ to: { facetValueIds: [] }, from: { facetValueIds: null } });
  });

  it.each(['value', 'parent', 'category', 'single'])('отвергает повреждённый выбор: %s', async (invalid) => {
    const b = new Types.ObjectId();
    const updateOne = jest.fn();
    const db = { collection: (name: string) => name === 'products'
      ? { findOne: async () => ({ _id: productId, passportDefaults: { passportCategory: 'BLG' } }), updateOne }
      : { find: (q: { dict: string }) => ({ toArray: async () => q.dict === 'productFacetValues'
        ? invalid === 'value' ? [] : [{ _id: value, parentId: parent }, ...(invalid === 'single' ? [{ _id: b, parentId: parent }] : [])]
        : invalid === 'parent' ? [] : [{ _id: parent, category: invalid === 'category' ? 'TRN' : 'BLG', multi: false }] }) } };
    await expect(patchPassportTemplate(db as never, productId, { facetValueIds: [String(value), ...(invalid === 'single' ? [String(b)] : [])] },
      { facetValueIds: null })).rejects.toThrow('facetValueIds');
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('одна запись сравнивает собственные критерии и defaults, не создавая passportDefaults.facetValueIds', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const db = { collection: () => ({ findOne: async () => ({ _id: productId }), updateOne }) };
    await patchPassportTemplate(db as never, productId, { facetValueIds: [], maxUsers: 2 }, { facetValueIds: null, maxUsers: null });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, stages] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, Array<{ $set: Record<string, unknown> }>];
    expect(filter.$expr).toEqual({ $and: [
      { $eq: [{ $ifNull: ['$$ROOT.facetValueIds', null] }, { $literal: null }] },
      { $eq: [{ $ifNull: ['$passportDefaults.maxUsers', null] }, { $literal: null }] },
    ] });
    expect(stages[0].$set.facetValueIds).toEqual({ $literal: [] });
    expect(JSON.stringify(stages[0].$set.passportDefaults)).not.toContain('facetValueIds');
  });
});

describe('C161: собственное значение краткого описания', () => {
  const a = new Types.ObjectId(), b = new Types.ObjectId(), product = new Types.ObjectId();

  it('сохраняет режим и порядок, вычисленный текст не передаётся в запись', () => {
    const before = { text: 'Свой текст.', partIds: [String(a)] };
    const { to, from } = parseTemplatePatch({ simpleDescription: { mode: 'parts', text: 'Подмена', partIds: [String(b), String(a), String(b)] } },
      { simpleDescription: before });
    expect(to).toEqual({ simpleDescription: { mode: 'parts', partIds: [b, a] } });
    expect(from).toEqual({ simpleDescription: { text: before.text, partIds: [a] } });
    expect(presentPassportDefaults(to)?.simpleDescription).toEqual({ mode: 'parts', partIds: [String(b), String(a)] });
  });

  it('сохраняет ручной режим и допускает исправление старого пустого выбора', () => {
    expect(parseTemplatePatch({ simpleDescription: { mode: 'manual', text: 'Свой текст.', partIds: [] } },
      { simpleDescription: { mode: 'parts', partIds: [] } })).toEqual({
      to: { simpleDescription: { mode: 'manual', text: 'Свой текст.', partIds: [] } },
      from: { simpleDescription: { mode: 'parts', partIds: [] } },
    });
  });

  it.each([
    [{ mode: 'parts', partIds: [] }, 'simpleDescription.partIds'],
    [{ mode: 'parts', partIds: ['wrong'] }, 'simpleDescription.partIds'],
    [{ mode: 'unknown', partIds: [String(a)] }, 'simpleDescription.mode'],
  ])('отвергает неверный выбор до записи %#', (simpleDescription, field) => {
    expect(() => parseTemplatePatch({ simpleDescription }, { simpleDescription: null })).toThrow(field);
  });

  it('проверяет текущее имя и принадлежность к справочнику одним запросом до записи', async () => {
    const updateOne = jest.fn();
    const find = jest.fn(() => ({ toArray: async () => [{ _id: a, name: ' ' }] }));
    const db = { collection: (name: string) => name === 'products' ? { findOne: async () => ({ _id: product }), updateOne } : { find } };
    await expect(patchPassportTemplate(db as never, product, { simpleDescription: { mode: 'parts', partIds: [String(a), String(b)] } },
      { simpleDescription: null })).rejects.toThrow(`Замените ссылки в кратком описании: ${a}, ${b}`);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ _id: { $in: [a, b] }, dict: 'passportParts', deletedAt: null }, expect.anything());
    expect(updateOne).not.toHaveBeenCalled();
  });
});
