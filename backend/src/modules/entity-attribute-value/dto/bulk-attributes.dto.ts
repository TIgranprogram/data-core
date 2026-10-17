import { IsObject } from 'class-validator';

export class BulkAttributesDto {
  /** Map of { attributeName: value }. */
  @IsObject()
  attributes!: Record<string, unknown>;
}
