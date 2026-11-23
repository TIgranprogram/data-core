import { mountStockWorktable } from './stock-worktable.js';
export { moveCell, noDrag } from './stock-grid-input.js';

/** C242: одна строка на materialId, метры не выдаются за физические штуки. */
export const mountPipeGrid = options => mountStockWorktable('pipe', options);
