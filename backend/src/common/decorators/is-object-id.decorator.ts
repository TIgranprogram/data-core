import { registerDecorator, ValidationOptions } from 'class-validator';
import { Types } from 'mongoose';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export function IsObjectId(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isObjectId',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          // String contract (e.g. from a JSON body): strict 24-hex regex.
          if (typeof value === 'string') return OBJECT_ID_RE.test(value);
          // Transformed contract: `@ToObjectId()` (class-transformer) converts
          // a valid string into a `Types.ObjectId` BEFORE class-validator runs
          // (ValidationPipe `transform: true`). A Types.ObjectId instance is by
          // construction a valid ObjectId, so accept it — DTOs pairing
          // `@IsObjectId() @ToObjectId()` (production-order, order-task,
          // work-type) validate correctly without weakening the string check.
          if (value instanceof Types.ObjectId) return true;
          return false;
        },
        defaultMessage(): string {
          return `${propertyName as string} must be a 24-char hex ObjectId`;
        },
      },
    });
  };
}
