import { ProductPassportSchema } from './product-passport.schema';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { databaseName, ensurePassportCreationIndex } = require('../../../scripts/passport-creation-index.js');

const base = { name: '_id_', key: { _id: 1 } };
const expected = { name: 'creationScopeKey_1', key: { creationScopeKey: 1 }, unique: true, sparse: true };
const mongo = (indexes: object[] = [base]) => {
  const collection = {
    indexes: jest.fn(async () => [...indexes]),
    createIndex: jest.fn(async (key: object, options: { name: string }) => {
      indexes.push({ ...options, key });
      return options.name;
    }),
  };
  const db = { collection: jest.fn(() => collection) };
  return { db, collection };
};

describe('План и создание индекса выпуска паспортов', () => {
  it('план читает только нужную коллекцию без записи', async () => {
    const { db, collection } = mongo();
    await expect(ensurePassportCreationIndex(db)).resolves.toBe('missing');
    expect(db.collection.mock.calls).toEqual([['productpassports']]);
    expect(collection.indexes).toHaveBeenCalledTimes(1);
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('apply создаёт ровно индекс схемы, проверяет его и безопасно повторяется', async () => {
    const { db, collection } = mongo();
    const [key, { name, unique, sparse }] = ProductPassportSchema.indexes().find(([, options]) => options.name === expected.name)!;
    await expect(ensurePassportCreationIndex(db, true)).resolves.toBe('created');
    expect(collection.createIndex.mock.calls).toEqual([[key, { name, unique, sparse }]]);
    expect(collection.createIndex).toHaveBeenCalledWith(expected.key, { name: expected.name, unique: true, sparse: true });
    expect(collection.indexes).toHaveBeenCalledTimes(2);
    await expect(ensurePassportCreationIndex(db)).resolves.toBe('ready');
    await expect(ensurePassportCreationIndex(db, true)).resolves.toBe('ready');
    expect(collection.createIndex).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...expected, sparse: false },
    { ...expected, unique: false },
    { ...expected, name: 'другой_индекс' },
    { ...expected, key: { productId: 1 } },
    { ...expected, partialFilterExpression: { status: 'draft' } },
  ])('конфликт параметров или имени останавливает создание %#', async (index) => {
    const { db, collection } = mongo([base, index]);
    await expect(ensurePassportCreationIndex(db, true)).rejects.toThrow('несовместимый индекс');
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('отсутствующую коллекцию не создаёт', async () => {
    const { db, collection } = mongo();
    collection.indexes.mockRejectedValueOnce({ code: 26 });
    await expect(ensurePassportCreationIndex(db, true)).rejects.toThrow('Коллекция productpassports отсутствует');
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('принимает целевые базы и точное имя собственной night-копии', () => {
    for (const name of ['datacore', 'datacore-night', 'datacore-test', 'datacore-2fd2723433a343191577b795-night']) expect(databaseName({ MONGO_DB: name })).toBe(name);
    for (const name of [undefined, 'datacoreqa', 'admin', 'other-night', 'datacore ', 'datacore-short-night', 'datacore-2fd2723433a343191577b795-night-other']) {
      expect(() => databaseName({ MONGO_DB: name })).toThrow('MONGO_DB');
    }
  });
});
