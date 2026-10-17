import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkerDto } from './create-worker.dto';

/**
 * TZ-WORKERS-301 — Update DTO for Worker.
 *
 * PartialType(CreateWorkerDto) — все поля опциональны, whitelist-only
 * (глобальный ValidationPipe). organizationId из DTO по-прежнему не
 * принимается (IDOR guard: берётся из req.user в контроллере).
 */
export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {}
