import { createConnection, Schema } from 'mongoose';
import { describeModels, describeSchema } from './meta-schema';

describe('meta-schema — самоописание базы', () => {
  const child = new Schema({ lineType: { type: String, enum: ['material', 'module'] }, qty: Number }, { _id: false });
  const schema = new Schema({
    name: { type: String, required: true },
    unit: { type: String, enum: ['шт', 'кг'] },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    tags: [String],
    photoIds: [{ type: Schema.Types.ObjectId, ref: 'Photo' }],
    composition: [child],
    passwordHash: String,
    tokenHash: String,
    refreshTokenVersion: Number,
  });

  it('типы, обязательность, enum, ссылки', () => {
    const f = Object.fromEntries(describeSchema(schema).map((x) => [x.path, x]));
    expect(f.name).toMatchObject({ type: 'String', required: true });
    expect(f.unit.enum).toEqual(['шт', 'кг']);
    expect(f.categoryId).toMatchObject({ type: 'ObjectId', ref: 'Category' });
    expect(f.tags).toMatchObject({ type: 'Array', itemType: 'String' });
    expect(f.photoIds).toMatchObject({ type: 'Array', ref: 'Photo' });
  });

  it('вложенные поддокументы описываются полями', () => {
    const comp = describeSchema(schema).find((x) => x.path === 'composition')!;
    const sub = Object.fromEntries((comp.fields ?? []).map((x) => [x.path, x]));
    expect(sub.lineType.enum).toEqual(['material', 'module']);
    expect(sub.qty.type).toBe('Number');
  });

  it('секретные поля не попадают в ответ, служебные «version» — попадают', () => {
    const paths = describeSchema(schema).map((x) => x.path);
    expect(paths).not.toContain('passwordHash');
    expect(paths).not.toContain('tokenHash');
    expect(paths).toContain('refreshTokenVersion');
    expect(paths).not.toContain('__v');
  });

  it('describeModels: имя коллекции, описание и тип из реестра админки', async () => {
    const conn = createConnection();
    conn.model('Material', new Schema({ name: String }), 'materials');
    const out = describeModels(conn);
    expect(out).toEqual([
      expect.objectContaining({ model: 'Material', collection: 'materials', kind: 'core' }),
    ]);
    expect(out[0].description.length).toBeGreaterThan(0);
    await conn.close();
  });
});
