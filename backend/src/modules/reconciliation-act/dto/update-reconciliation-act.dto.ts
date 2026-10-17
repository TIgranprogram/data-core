import { PartialType } from '@nestjs/mapped-types';
import { CreateReconciliationActDto } from './create-reconciliation-act.dto';

export class UpdateReconciliationActDto extends PartialType(CreateReconciliationActDto) {}
