import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { renderPassportPdfV2 } from './passport-pdf-v2';
import type { PdfV2Input } from './passport-pdf-v2-types';
import { exerciseInstructions } from '../../common/passport/exercise-instructions';
describe('C236 реальный PDF', () => {
  it.each(['short', 'full'])('печатает отдельный блок без use-секции, %s', async variant => {
    const exercise = { initialPosition: 'Сесть.\n\nВзяться за рукояти.', movement: 'Двигаться плавно.', muscles: 'Мышцы ног.', source: { kind: 'product' as const, productId: 'model-a' } };
    const input: PdfV2Input = { passport: { name: 'Образец', passportCategory: 'TRN', presentationVersion: 1, variant, status: 'draft' }, text: { layout: 2, sections: [], exerciseInstructions: exercise }, org: null, images: {}, withStamp: false, mode: 'pages' };
    const pdf = await renderPassportPdfV2(input);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('собирает адресные evidence только по явному флагу', async () => {
    const destination = process.env.C236_EVIDENCE_DIR;
    if (!destination) return;
    mkdirSync(destination, { recursive: true });
    const pilots = JSON.parse(readFileSync(resolve('../tools/logs/c236-c243-readonly/pilots.json'), 'utf8').replace(/^\uFEFF/, ''));
    const content = JSON.parse(readFileSync(resolve('../docs/crew/C236-trainer-exercise-instructions/PILOT-CONTENT.json'), 'utf8'));
    for (const sku of ['1067', '1068']) for (const variant of ['short', 'full']) {
      const template = pilots[sku][variant];
      const candidate = content.items.find((row: { sku: string }) => row.sku === sku);
      const block = exerciseInstructions({ initialPosition: candidate.initialPosition, movement: candidate.movement, muscles: candidate.muscles });
      const text = { ...template.textSnapshot, exerciseInstructions: { ...block, source: { kind: 'product', productId: pilots[sku].id } } };
      expect(text.sections.find((s: { key: string }) => s.key === 'use').items).toHaveLength(sku === '1067' ? 11 : 15);
      expect(text.rules).toHaveLength(sku === '1067' ? 4 : 0);
      const input = { passport: { ...template.document, status: 'draft' }, text, org: null, images: {}, withStamp: false, mode: 'pages' } as PdfV2Input;
      writeFileSync(join(destination, `${sku}-${variant}-draft.json`), JSON.stringify(input, null, 2));
      writeFileSync(join(destination, `${sku}-${variant}-draft.pdf`), await renderPassportPdfV2(input));
    }
  });
});
