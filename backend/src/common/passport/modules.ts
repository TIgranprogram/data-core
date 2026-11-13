import { BadRequestException } from '@nestjs/common';

/**
 * C095: модуль сборного изделия (экотропа и т. п.) — название, габариты строкой, количество в штуках, рисунок (фото изделия, вид `module`).
 * Один формат в умолчаниях изделия (`passportDefaults.modules`) и в паспорте (`modules`). Пустой список — модулей нет.
 */
export interface PassportModule { name: string; dims?: string; qty: number; photoId?: string }

export const MODULES_MAX = 20;

/** Проверка и очистка списка модулей. Ошибка — 400 с номером модуля по-русски. null/undefined → []. */
export function parseModules(raw: unknown): PassportModule[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('Модули: ожидается список');
  if (raw.length > MODULES_MAX) throw new BadRequestException(`Не больше ${MODULES_MAX} модулей`);
  return raw.map((m, i) => {
    const n = i + 1;
    const o = (m ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) throw new BadRequestException(`Модуль ${n}: укажите название`);
    if (name.length > 120) throw new BadRequestException(`Модуль ${n}: название не длиннее 120 знаков`);
    const dims = String(o.dims ?? '').trim();
    if (dims.length > 60) throw new BadRequestException(`Модуль ${n}: габариты не длиннее 60 знаков`);
    const qty = Number(String(o.qty ?? '').replace(',', '.'));
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw new BadRequestException(`Модуль ${n}: количество — целое от 1 до 10000`);
    const photoId = String(o.photoId ?? '').trim();
    if (photoId && !/^[0-9a-f]{24}$/i.test(photoId)) throw new BadRequestException(`Модуль ${n}: неверный рисунок`);
    return { name, ...(dims ? { dims } : {}), qty, ...(photoId ? { photoId } : {}) };
  });
}

/** Итого модулей — простая сумма количеств. */
export const modulesTotal = (list: PassportModule[] | undefined | null) => (list || []).reduce((s, m) => s + (Number(m.qty) || 0), 0);
