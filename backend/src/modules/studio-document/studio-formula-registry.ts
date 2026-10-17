import { tableAggregateValue, type TableAggregateKey } from './studio-table-tokens';
import type { StudioTableColumn } from './studio-data-resolver';

export type StudioFormulaId = 'column-sum' | 'percent-of-subtotal' | 'vat' | 'grand-with-vat';

export interface StudioFormulaDefinition {
  readonly id: StudioFormulaId;
  readonly label: string;
  readonly token: string;
  readonly needsRate?: boolean;
}

export const STUDIO_FORMULA_REGISTRY: readonly StudioFormulaDefinition[] = [
  { id: 'column-sum', label: 'Сумма столбца', token: '{{table.subtotal}}' },
  { id: 'percent-of-subtotal', label: '% от суммы', token: '{{table.subtotal}}', needsRate: true },
  { id: 'vat', label: 'НДС', token: '{{table.vat}}' },
  { id: 'grand-with-vat', label: 'Итого с НДС', token: '{{table.grand}}' },
];

export function evaluateStudioFormula(
  formulaId: StudioFormulaId,
  columns: StudioTableColumn[],
  rows: string[][],
  vatPercent: number,
  rate = 0,
): string {
  const subtotal = tableAggregateValue(columns, rows, 'subtotal', vatPercent);
  const vat = tableAggregateValue(columns, rows, 'vat', vatPercent);
  const grand = tableAggregateValue(columns, rows, 'grand', vatPercent);
  switch (formulaId) {
    case 'column-sum':
      return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(subtotal);
    case 'percent-of-subtotal':
      return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(subtotal * rate / 100);
    case 'vat':
      return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(vat);
    case 'grand-with-vat':
      return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(grand);
    default:
      return '';
  }
}

export function formulaTokenFor(id: StudioFormulaId): string {
  return STUDIO_FORMULA_REGISTRY.find((item) => item.id === id)?.token ?? '';
}

export function isTableAggregateKey(value: string): value is TableAggregateKey {
  return value === 'subtotal' || value === 'vat' || value === 'grand';
}
