import { Schema } from 'mongoose';
import { optimisticLockPlugin } from './optimistic-lock.plugin';

describe('optimisticLockPlugin (TZ-CATALOG-339)', () => {
  it('enables versionKey __v without registering a pre-save __v mutator', () => {
    const schema = new Schema({ name: String, tags: [String] });
    optimisticLockPlugin(schema);
    expect(schema.get('versionKey')).toBe('__v');
    const preSave = (schema as unknown as { s?: { hooks?: { pre?: Map<string, unknown[]> } } }).s
      ?.hooks?.pre;
    // No manual __v bump hook — mongoose versionKey owns increments.
    const saveHooks = preSave?.get?.('save') ?? [];
    const bumpish = (Array.isArray(saveHooks) ? saveHooks : []).filter((h) =>
      String(h).includes('__v'),
    );
    expect(bumpish).toHaveLength(0);
  });
});
