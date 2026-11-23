import { parseTemplatePatch } from '../showcase/passport-template-patch';
import { normalizePassportDefaults } from '../showcase/passport-defaults';
import { productPatch } from './passport-from-product';
import { buildV2Text } from './passport-v2-text';
const block = { initialPosition: ' Сесть.\r\n\r\nВзяться за рукояти. ', movement: 'Двигать плавно.', muscles: 'Мышцы ног.' };
describe('C236 захват и снимок', () => {
  it('CAS whole block, null clear и baseline без trim', () => {
    const parsed = parseTemplatePatch({ exerciseInstructions: block }, { exerciseInstructions: block });
    expect(parsed.from.exerciseInstructions).toEqual(block);
    expect(parsed.to.exerciseInstructions).toEqual(normalizePassportDefaults({ exerciseInstructions: block }).exerciseInstructions);
    expect(parseTemplatePatch({ exerciseInstructions: null }, { exerciseInstructions: block }).to).toEqual({ exerciseInstructions: null });
  });
  it('захват только явно, снимок хранит copy/source, use и rules не подменяются', async () => {
    const db = { collection: () => ({ findOne: async () => null }) } as never;
    const prod = { _id: 'model-a', passportDefaults: { exerciseInstructions: block } };
    expect(await productPatch(db, prod)).not.toHaveProperty('exerciseInstructions');
    const captured = await productPatch(db, prod, { captureExercise: true });
    const p = { ...captured, productId: prod._id, passportCategory: 'TRN' };
    const all = { sections: [{ key: 'use', title: 'Пользование', paragraphs: ['Сохранённая безопасность.'] }] };
    const base = buildV2Text({ passport: { ...p, exerciseInstructions: undefined }, all });
    const text = buildV2Text({ passport: p, all });
    expect(text.sections).toEqual(base.sections); expect(text.rules).toEqual(base.rules);
    expect(text.exerciseInstructions).toMatchObject({ source: { kind: 'product', productId: 'model-a' }, movement: block.movement });
    expect(buildV2Text({ passport: {}, all })).not.toHaveProperty('exerciseInstructions');
  });
});
