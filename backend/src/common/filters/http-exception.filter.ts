import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import type { ValidationError } from 'class-validator';
import { randomBytes } from 'crypto';
import { fieldRu, hasCyrillic, localizeFieldPrefix, russianFallback, translateMessage } from './error-messages-ru';

const VALIDATION_MESSAGES: Record<string, string> = {
  isString: 'Должно быть строкой',
  isNumber: 'Должно быть числом',
  isBoolean: 'Должно быть логическим значением',
  isEmail: 'Некорректный email',
  isNotEmpty: 'Не должно быть пустым',
  isObjectId: 'Некорректный идентификатор (ожидается 24-символьный hex)',
  isMongoId: 'Некорректный идентификатор MongoDB',
  isEnum: 'Значение не входит в допустимый список',
  isIn: 'Значение не входит в допустимый список',
  isOptional: '',
  isInt: 'Должно быть целым числом',
  minLength: 'Слишком короткое значение',
  maxLength: 'Слишком длинное значение',
  min: 'Значение слишком мало',
  max: 'Значение слишком велико',
  matches: 'Некорректный формат значения',
  isDate: 'Некорректная дата',
  isDateString: 'Некорректный формат даты',
  arrayNotEmpty: 'Массив не должен быть пустым',
  isArray: 'Должно быть массивом',
  isObject: 'Должно быть объектом',
};

const NOT_FOUND_RU: Record<string, string> = {
  Product: 'Изделие не найдено',
  ProductModule: 'Модуль не найден',
  Module: 'Модуль не найден',
  Material: 'Материал не найден',
  Photo: 'Фото не найдено',
  ProductPhoto: 'Фото не найдено',
  Counterparty: 'Контрагент не найден',
  Order: 'Заказ не найден',
  User: 'Пользователь не найден',
  Contract: 'Договор не найден',
  Shipment: 'Отгрузка не найдена',
  Comment: 'Комментарий не найден',
  SupplyTask: 'Задача снабжения не найдена',
  TechProcess: 'Техпроцесс не найден',
  TextBlock: 'Текстовый блок не найден',
  InventorFile: 'Файл Inventor не найден',
  AttributeDefinition: 'Определение атрибута не найдено',
  FinancialReport: 'Финансовый отчёт не найден',
  Interaction: 'Взаимодействие не найдено',
  DocumentTemplateCategory: 'Категория шаблона не найдена',
  Status: 'Статус не найден',
};

const ENTITY_NOT_FOUND = /^([A-Za-z][A-Za-z0-9]*)\s+(.+)\s+not found$/i;
const MISSING_ID = /^(undefined|null)$/i;

/** User-facing RU for Nest `Entity <id> not found`. Unknown entities → «Объект не найден». */
export function humanizeNotFoundMessage(message: string): string {
  const match = message.trim().match(ENTITY_NOT_FOUND);
  if (!match) return message;
  const entity = match[1];
  const id = match[2].trim();
  const ru = NOT_FOUND_RU[entity] ?? 'Объект не найден';
  if (!id || MISSING_ID.test(id)) {
    return `${ru}: не указан идентификатор`;
  }
  return ru;
}

// class-validator's actual generated wording for "must be X" constraints
// never literally contains the decorator's camelCase name (e.g. @IsMongoId()
// says "a mongodb id", not "mongoid") — so the VALIDATION_MESSAGES lookup
// below never matched anything and silently fell through to raw English.
// Verified live against this backend (2026-08-30) for the fields
// composition-line.dto.ts actually uses: IsMongoId (refId), IsNumber
// (quantity), IsIn (lineType).
const MUST_BE_RU: [pattern: RegExp, ru: string][] = [
  [/mongodb id/, VALIDATION_MESSAGES.isMongoId],
  [/a number conforming to the specified constraints/, VALIDATION_MESSAGES.isNumber],
  [/one of the following values/, VALIDATION_MESSAGES.isIn],
];

/** Humanize one class-validator constraint clause (no "; " separators left). */
function humanizeConstraintClause(clause: string): string {
  const trimmed = clause.trim();
  if (!trimmed) return '';
  const ru = translateMessage(trimmed);
  if (ru) return ru;

  const lengthConstraint = trimmed.match(
    /^(\S+) must be (longer than or equal to|shorter than or equal to) .+ characters$/i,
  );
  if (lengthConstraint) {
    const [, field, direction] = lengthConstraint;
    return `${field}: ${direction.toLowerCase().startsWith('longer') ? VALIDATION_MESSAGES.minLength : VALIDATION_MESSAGES.maxLength}`;
  }

  const mustBe = trimmed.match(/^(\w+) must be (.+)$/i);
  if (mustBe) {
    const [, field, rest] = mustBe;
    const lower = rest.toLowerCase();
    for (const [pattern, ru] of MUST_BE_RU) {
      if (pattern.test(lower)) return `${field}: ${ru}`;
    }
    for (const [key, ru] of Object.entries(VALIDATION_MESSAGES)) {
      if (lower.includes(key.toLowerCase()) && ru) return `${field}: ${ru}`;
    }
    // Fallback for unknown constraints — keep original to aid debugging
    return `Поле "${field}": ${trimmed}`;
  }

  // @Min()/@Max(): "$property must not be less/greater than $n" — different
  // verb than the "must be" branch above. @Min() verified live (quantity's
  // 0.000001 floor); @Max() is its documented mirror, not independently
  // re-triggered against a live endpoint.
  const notLess = trimmed.match(/^(\w+) must not be less than (.+)$/i);
  if (notLess) return `${notLess[1]}: ${VALIDATION_MESSAGES.min}`;
  const notGreater = trimmed.match(/^(\w+) must not be greater than (.+)$/i);
  if (notGreater) return `${notGreater[1]}: ${VALIDATION_MESSAGES.max}`;

  return trimmed;
}

export function humanizeValidationMessage(message: string): string {
  if (typeof message !== 'string') return 'Ошибка валидации';

  const trimmed = message.trim();
  const ru = translateMessage(trimmed);
  if (ru) return ru;
  const notFound = humanizeNotFoundMessage(trimmed);
  if (notFound !== trimmed) return notFound;

  // NestJS joins multiple failed constraints for the same property with
  // "; " into one message string — humanize each clause independently.
  return trimmed
    .split(';')
    .map(humanizeConstraintClause)
    .filter(Boolean)
    .join('; ');
}

function replaceLeafProperty(message: string, propertyPath: string, leafProperty: string): string {
  const leafPrefix = `${leafProperty}:`;
  return message.startsWith(leafPrefix)
    ? `${propertyPath}:${message.slice(leafPrefix.length)}`
    : `${propertyPath}: ${message}`;
}

/**
 * Flattens class-validator's nested error tree into operator-facing lines.
 * Parent `nestedValidation` dumps are intentionally ignored when children
 * exist; only leaf constraints are humanized and emitted with their full path.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): string[] {
  const lines: string[] = [];
  for (const error of errors) {
    const propertyPath = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const children = error.children ?? [];
    if (children.length > 0) {
      lines.push(...flattenValidationErrors(children, propertyPath));
      continue;
    }
    const constraints = Object.values(error.constraints ?? {});
    if (constraints.length === 0) {
      lines.push(`${propertyPath}: Ошибка валидации`);
      continue;
    }
    for (const constraint of constraints) {
      const humanized = humanizeValidationMessage(constraint);
      lines.push(replaceLeafProperty(humanized, propertyPath, error.property));
    }
  }
  return lines;
}

/**
 * Mongoose throws this when a value cannot be coerced into the schema type —
 * most often `Cast to ObjectId failed for value "undefined" at path "_id"`.
 */
function isCastError(exception: unknown): boolean {
  return (
    exception instanceof Error &&
    exception.name === 'CastError' &&
    typeof (exception as { path?: unknown }).path === 'string'
  );
}

/**
 * ЧН (2026-10-23): Mongoose ValidationError (значение не подошло под схему: «abc» в числовом поле, пустое обязательное)
 * — ошибка данных запроса, не сервера: 400 с полем и тем, что не так, вместо голого 500.
 */
type MongooseFieldError = { path?: string; kind?: string; value?: unknown; name?: string };
function mongooseFieldErrors(exception: unknown): MongooseFieldError[] | undefined {
  if (!(exception instanceof Error) || exception.name !== 'ValidationError') return undefined;
  const errors = (exception as { errors?: Record<string, MongooseFieldError> }).errors;
  return errors && typeof errors === 'object' ? Object.values(errors) : undefined;
}
const KIND_RU: Record<string, string> = { Number: 'нужно число', Date: 'нужна дата', ObjectId: 'нужно выбрать из списка', Boolean: 'нужно «да» или «нет»', required: 'нужно заполнить', enum: 'значение не из списка' };
const fieldErrorText = (e: MongooseFieldError) => {
  const path = String(e.path ?? '');
  const leaf = path.split('.').pop() || path;
  const v = e.value === undefined || e.value === null ? '' : String(typeof e.value === 'object' ? JSON.stringify(e.value) : e.value).slice(0, 40);
  return `Поле «${fieldRu(leaf)}»: ${KIND_RU[String(e.kind)] ?? 'неверное значение'}${v ? ` (сейчас «${v}»)` : ''}`;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Mongoose CastError (e.g. GET /admin/users/undefined) is a CLIENT mistake,
    // not a server fault. Before this it escaped as HTTP 500 + full stack in the
    // logs, so a stale frontend id (or a hand-typed URL) looked like an outage.
    // Now it is a plain 400 with the offending field named.
    const castPath = isCastError(exception)
      ? String((exception as { path?: unknown }).path ?? '_id')
      : undefined;

    const fieldErrors = exception instanceof HttpException ? undefined : mongooseFieldErrors(exception);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : castPath !== undefined || fieldErrors
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : fieldErrors
          ? { message: fieldErrors.map(fieldErrorText), missing: fieldErrors.map((e) => ({ key: String(e.path ?? '').split('.')[0], label: fieldRu(String(e.path ?? '').split('.').pop() || '') })) }
          : castPath !== undefined
            ? `Некорректный идентификатор «${castPath}»: ожидается 24-символьный hex`
            : 'Internal server error';

    let message: string | string[];

    if (typeof payload === 'string') {
      message = humanizeValidationMessage(payload);
    } else {
      const raw =
        (payload as { message?: string | string[] }).message ?? payload;
      if (Array.isArray(raw)) {
        message = raw.map(humanizeValidationMessage).filter(Boolean);
      } else {
        message = humanizeValidationMessage(
          typeof raw === 'string' ? raw : JSON.stringify(raw),
        );
      }
    }

    // Последний рубеж: всё, что осталось без перевода, — понятный русский текст по коду ответа,
    // английский оригинал — в `detail` (для разработчиков и ИИ-клиентов API).
    const originals: string[] = [];
    const ensureRu = (m: string) => {
      if (m && hasCyrillic(m)) return localizeFieldPrefix(m);
      if (!m) return m;
      originals.push(m);
      return russianFallback(status);
    };
    message = Array.isArray(message) ? [...new Set(message.map(ensureRu))] : ensureRu(message);

    const errorResponse: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      ...(originals.length ? { detail: originals.join('; ') } : {}),
    };

    // Preserve structured codes from HttpException object payloads
    // (e.g. SYSTEM_ROLE_FROZEN / SYSTEM_ROLE_ESCALATION) for FE toast routing.
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'code' in payload &&
      typeof (payload as { code?: unknown }).code === 'string'
    ) {
      errorResponse.code = (payload as { code: string }).code;
    }
    // ПП / ОШ: список полей, которых не хватает ([{ label, key }]) — форма подсветит
    if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { missing?: unknown }).missing)) {
      errorResponse.missing = (payload as { missing: unknown[] }).missing;
    }

    // КМ4: договоры с несопоставленными позициями ([{ orderId, orderNo, total, unmatched, lines }]) — кнопка «Перейти к сопоставлению»
    if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { unmatched?: unknown }).unmatched)) {
      errorResponse.unmatched = (payload as { unmatched: unknown[] }).unmatched;
    }

    // CC-14: «Разбор» — данные изменились после предпросмотра, в ответе новый предпросмотр (planHash и строки плана)
    if (typeof payload === 'object' && payload !== null && typeof (payload as { preview?: unknown }).preview === 'object' && (payload as { preview?: unknown }).preview !== null) {
      errorResponse.preview = (payload as { preview: unknown }).preview;
    }

    // ЧН: код сбоя — пользователь называет его, разработчик находит запись в журнале (docker logs … | grep код)
    const errorId = status >= 500 ? randomBytes(3).toString('hex').toUpperCase() : undefined;
    if (errorId) errorResponse.errorId = errorId;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} [сбой ${errorId}]`,
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception),
      );
    }

    response.status(status).json(errorResponse);
  }
}
