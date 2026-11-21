import { validateSync } from 'class-validator';
import { InvoiceReviewDto } from './dto-invoice-review';

describe('InvoiceReviewDto', () => {
  const sourceSizeErrors = (sourceSize: number) => validateSync(
    Object.assign(new InvoiceReviewDto(), { sourceSize }),
  ).find(error => error.property === 'sourceSize');

  it('допускает ровно 15 МиБ и отклоняет больший PDF до передачи файла', () => {
    const limit = 15 * 1024 * 1024;
    expect(sourceSizeErrors(limit)).toBeUndefined();
    expect(sourceSizeErrors(limit + 1)?.constraints?.max).toBe('Размер PDF для отправки — до 15 МиБ');
  });
});
