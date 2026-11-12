/**
 * C095: варианты модуля сборного изделия. Чистые функции без БД — их берут форма (через API), проверка и PDF.
 * Нет вариантов — паспорт печатается как раньше (раздела нет).
 */
export interface ModuleVariant { name?: string; size?: string; qty?: number; photoId?: unknown }

/** Только заполненные варианты: есть название и целое количество > 0. */
export function cleanModules(list: ModuleVariant[] | null | undefined): Array<{ name: string; size: string; qty: number; photoId: string }> {
  return (list || [])
    .map((m) => ({ name: String(m?.name ?? '').trim(), size: String(m?.size ?? '').trim(), qty: Number(m?.qty), photoId: m?.photoId ? String(m.photoId) : '' }))
    .filter((m) => m.name && Number.isInteger(m.qty) && m.qty > 0);
}

/** Всего модулей — простая сумма; строка «Всего» нужна только при двух и более вариантах. */
export function modulesTotal(list: ModuleVariant[] | null | undefined): number {
  return cleanModules(list).reduce((s, m) => s + m.qty, 0);
}
