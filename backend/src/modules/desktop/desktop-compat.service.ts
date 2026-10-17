import { Injectable } from '@nestjs/common';

/** Контракт совместимости Desktop ↔ сайт (TZD-40). */
export interface DesktopCompatInfo {
  /** Минимальная версия Desktop, которая ещё работает с этим сервером. */
  minDesktopVersion: string;
  /** Рекомендуемая версия Desktop (ниже неё — мягкий баннер). */
  recommendedDesktopVersion: string;
  /** URL установщика (относительный → desktop резолвит от apiBaseUrl). */
  downloadUrl: string;
  /** Идентификатор сборки сервера (env APP_VERSION; иначе unknown). */
  serverBuildId: string;
}

/** Пустая строка / пробелы / нестрока → считаем не задано. */
function envTrim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * TZD-40: единый SoT версии Desktop на стороне сервера.
 *
 * Источник — env (deploy inject): `DESKTOP_MIN_VERSION`,
 * `DESKTOP_RECOMMENDED_VERSION`, `DESKTOP_DOWNLOAD_URL`, `APP_VERSION`.
 * Без env — fail-open: min/recommended = '0.0.0' → баннер не показывается
 * (старое поведение), downloadUrl = same-origin default (как в FE meta).
 *
 * Сравнение версий выполняет клиент (desktop/src/core/version-compat.ts);
 * сервер не блокирует — только отдаёт числа.
 */
@Injectable()
export class DesktopCompatService {
  compat(): DesktopCompatInfo {
    return {
      minDesktopVersion: envTrim(process.env.DESKTOP_MIN_VERSION) ?? '0.0.0',
      recommendedDesktopVersion:
        envTrim(process.env.DESKTOP_RECOMMENDED_VERSION) ?? '0.0.0',
      downloadUrl:
        envTrim(process.env.DESKTOP_DOWNLOAD_URL) ??
        '/downloads/kppdf-desktop-setup.zip',
      serverBuildId: envTrim(process.env.APP_VERSION) ?? 'unknown',
    };
  }
}
