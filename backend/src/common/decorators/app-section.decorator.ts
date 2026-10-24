import { SetMetadata } from '@nestjs/common';
import type { AppSectionId } from '../app-sections';

export const APP_SECTION_KEY = 'appSection';

/**
 * SK-8d: к какому разделу «Рабочего места» относится маршрут (класс или метод;
 * метод переопределяет класс). Несколько разделов — доступ, если открыт любой.
 * Проверяет AppSectionGuard по разделам роли (common/app-sections.ts).
 *
 * @example
 *   @AppSection('stock')
 *   @Controller('stock')
 *   export class StockController { … }
 */
export const AppSection = (...ids: AppSectionId[]) => SetMetadata(APP_SECTION_KEY, ids);

/** Снять пометку класса с метода: маршрут открыт всегда (справочные списки). */
export const AppSectionFree = () => SetMetadata(APP_SECTION_KEY, []);
