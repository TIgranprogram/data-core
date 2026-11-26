import { SetMetadata } from '@nestjs/common';

export const OWNER_IDEMPOTENCY = Symbol('owner-idempotency');

/** Обработчик сам проверяет повтор по сохранённому намерению. */
export const OwnerIdempotency = (): MethodDecorator => SetMetadata(OWNER_IDEMPOTENCY, true);
