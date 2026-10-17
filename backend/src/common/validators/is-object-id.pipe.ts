import {
  BadRequestException,
  Injectable,
  Param,
  PipeTransform,
} from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * TZ-119 §1.1 — Mongoose ObjectId validation pipe (strict).
 *
 * Use on every controller `@Param('id', IsObjectIdPipe)` (or the
 * companion `IsObjectIdParam('id')` decorator) so invalid IDs surface
 * as `400 BadRequest` instead of crashing in Mongoose with
 * `BSONError: input must be a 24 character hex string`.
 *
 * Strict contract: throws on empty / null / undefined inputs.
 * For OPTIONAL path segments, use `IsOptionalObjectIdPipe` instead —
 * it returns `Types.ObjectId | null` rather than throwing.
 */
@Injectable()
export class IsObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string): Types.ObjectId {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException('ObjectId is required');
    }
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ObjectId: ${value}`);
    }
    return new Types.ObjectId(value);
  }
}

/**
 * TZ-119.1 — Optional variant for path segments such as
 * `/api/products/:parentId`. Returns `null` on empty inputs instead
 * of throwing. `transform()` signature explicitly carries the nullable
 * return — no cast workarounds required.
 */
@Injectable()
export class IsOptionalObjectIdPipe implements PipeTransform<string | null | undefined, Types.ObjectId | null> {
  transform(value: string | null | undefined): Types.ObjectId | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ObjectId: ${value}`);
    }
    return new Types.ObjectId(value);
  }
}

/**
 * Convenience decorator: combines `@Param('id')` + `@IsObjectIdPipe`
 * (optional variant via `{ optional: true }` flag).
 *
 * Usage:
 *   @IsObjectIdParam('id') id: Types.ObjectId,
 *   @IsObjectIdParam('parentId', { optional: true }) parentId: Types.ObjectId | null,
 */
export function IsObjectIdParam(
  paramName: string,
  options: { optional?: boolean } = {},
): ParameterDecorator {
  return Param(paramName, options.optional ? new IsOptionalObjectIdPipe() : new IsObjectIdPipe());
}
