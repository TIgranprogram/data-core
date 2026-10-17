import { PartialType } from '@nestjs/mapped-types';
import { CreateTextBlockDto } from './create-text-block.dto';

/**
 * TZ-86 Phase A.1 — UpdateTextBlockDto via PartialType of Create.
 *
 * All fields optional; service-layer enforces slug uniqueness via Mongo
 * unique index + duplicate-key catch (11000 → ConflictException).
 */
export class UpdateTextBlockDto extends PartialType(CreateTextBlockDto) {}
