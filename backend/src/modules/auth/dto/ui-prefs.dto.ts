import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min, validate } from 'class-validator';

/**
 * ШП-1 — PATCH /api/auth/me/prefs: ширины панелей «Рабочего места», px.
 * Все ключи необязательны, пишутся только присланные. Лишний ключ → 400
 * (глобальный ValidationPipe с forbidNonWhitelisted), строка вместо числа → 400.
 */
export class UiPrefsDto {
  @ApiPropertyOptional({ minimum: 200, maximum: 360, example: 248, description: 'Ширина левого меню' })
  @IsOptional()
  @IsInt()
  @Min(200)
  @Max(360)
  sidebarW?: number;

  @ApiPropertyOptional({ minimum: 360, maximum: 1400, example: 700, description: 'Ширина правой панели ввода' })
  @IsOptional()
  @IsInt()
  @Min(360)
  @Max(1400) // ПРД.3: как в приложении (core/prefs.js PREFS) — иначе 400 молча, и после обновления возвращалась старая ширина
  detailW?: number;

  @ApiPropertyOptional({ minimum: 240, maximum: 700, example: 340, description: 'Ширина панели фильтров' })
  @IsOptional()
  @IsInt()
  @Min(240)
  @Max(700)
  filterW?: number;

  @ApiPropertyOptional({ minimum: 320, maximum: 1200, example: 520, description: 'Ширина окна чата' })
  @IsOptional()
  @IsInt()
  @Min(320)
  @Max(1200) // как в приложении (core/prefs.js PREFS.chatW)
  chatW?: number;

  @ApiPropertyOptional({ example: 'all', description: 'Чат: последний открытый собеседник — id пользователя или all' })
  @IsOptional()
  @Matches(/^(all|[a-f0-9]{24})$/, { message: 'lastChat — id пользователя или all' })
  lastChat?: string;

  @ApiPropertyOptional({ example: 'two', description: 'Вид правой панели: one | two | wide' })
  @IsOptional()
  @Matches(/^(one|two|wide)$/, { message: 'panelLayout — one, two или wide' })
  panelLayout?: string;

  @ApiPropertyOptional({ example: 'large', description: 'Вид экрана: normal | large (крупный)' })
  @IsOptional()
  @Matches(/^(normal|large)$/, { message: 'viewScale — normal или large' })
  viewScale?: string;
}

/** Свободные настройки (например `bgrp:<доска>` — раскрытые группы): пределы. */
export const FREE_PREF_KEY_RE = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;
export const FREE_PREF_MAX_VALUE = 4096;
export const FREE_PREF_MAX_KEYS = 200;
const KNOWN = new Set(['sidebarW', 'detailW', 'filterW', 'chatW', 'lastChat', 'panelLayout', 'viewScale']);

/**
 * Тело PATCH /api/auth/me/prefs: известные ключи — по UiPrefsDto, прочие — свободные
 * (ключ ≤ 80 символов, значение — строка ≤ 4 КБ или null для сброса). Иначе 400 по-русски.
 */
export async function parseUiPrefs(body: unknown): Promise<Record<string, number | string | null>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Настройки: ожидается объект «ключ — значение»');
  }
  const known: Record<string, unknown> = {};
  const free: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (KNOWN.has(k)) { known[k] = v; continue; }
    if (!FREE_PREF_KEY_RE.test(k)) {
      throw new BadRequestException(`Настройка «${k.slice(0, 40)}»: ключ — латиница, цифры, _ : -, до 80 символов`);
    }
    if (v !== null && typeof v !== 'string') throw new BadRequestException(`Настройка «${k}»: значение — строка или null`);
    if (typeof v === 'string' && v.length > FREE_PREF_MAX_VALUE) {
      throw new BadRequestException(`Настройка «${k}»: значение длиннее 4 КБ`);
    }
    free[k] = v;
  }
  if (Object.keys(free).length > FREE_PREF_MAX_KEYS) {
    throw new BadRequestException('Слишком много настроек за один запрос (не больше 200)');
  }
  const dto = plainToInstance(UiPrefsDto, known);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
  }
  return { ...(known as Record<string, number | string | null>), ...free };
}
