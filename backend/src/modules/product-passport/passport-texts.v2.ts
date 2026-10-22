import type { PassportTemplateContent } from './passport-template.default';
import texts from '../../../scripts/passport-texts.v2.json';

/**
 * Тексты паспортов v2 по категориям (БЗ-6 Э7, docs/PASSPORTS-V2.md §3.2, §6) — написаны своими словами по смыслу ГОСТ/ТР.
 *
 * Где лежат: сами тексты — `backend/scripts/passport-texts.v2.json` (один источник). Этот модуль только даёт им тип;
 * скрипт записи версий `scripts/seed-passport-texts.js` (CommonJS) читает тот же JSON через require — без сборки и копий.
 *
 * Формат — как DEFAULT_PASSPORT_TEMPLATE: sections[{ key, title, paragraphs[] }], tables[]. Сборка (passport-compose.ts,
 * legacyTemplateToBlocks): ключ пункта = раздел + номер по порядку (p1, p2 …). Отсюда правила для версий категорий:
 *  - раздел категории с ключом, как у раздела «Для всех», ЗАМЕНЯЕТ его первые N пунктов (N — сколько пунктов в разделе
 *    категории) и остаётся на месте раздела «Для всех». Поэтому в «Для всех» пункт, зависящий от категории (норматив),
 *    стоит первым: «general» п. 1 (что за изделие и по какому стандарту), «service» п. 1 (по какому стандарту ТО);
 *  - новый раздел категории с индексом i в массиве встаёт сразу после раздела «Для всех» с тем же индексом i
 *    (0 общие указания, 1 монтаж, 2 ТО, 3 ремонт …). Индексы подобраны так, чтобы «Ограничения и правила» шли после
 *    общих указаний, а «Подвижные узлы» / «Осмотры» — после ТО. Итоговый порядок закреплён тестом.
 * Переменные: {name} {warrantyMonths} {serviceLifeYears} и поля, обязательные для категории (V2_REQUIRED_FIELDS);
 * нормативы — только {std:КОД} (коды — scripts/seed-passport-standards.js); {fig:вид}, {tab:ключ таблицы} — для PDF.
 * Нумерация «Для всех» начинается с 3 (1 Описание и 2 Технические данные выводит PDF) — legacyStartNumber.
 */
export type PassportTextsCategory = 'ALL' | 'TRN' | 'WRK' | 'DSP' | 'MAF' | 'DIO';

export const PASSPORT_TEXTS_V2: Record<PassportTextsCategory, PassportTemplateContent> = texts as Record<PassportTextsCategory, PassportTemplateContent>;
