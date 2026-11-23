import { mountStockWorktable } from './stock-worktable.js';
export { gridField } from './stock-grid-input.js';

/** C242: отдельные строки листов и обрезков, исходная единица учёта. */
export const mountSheetGrid = options => mountStockWorktable('sheet', options);
