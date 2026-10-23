/** Нормализация текста для сравнения: обрезать, нижний регистр, схлопнуть пробелы. */
export const normText = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
