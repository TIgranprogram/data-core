import { PartialType } from '@nestjs/mapped-types';
import { CreateComplianceRuleDto } from './create-compliance-rule.dto';

export class UpdateComplianceRuleDto extends PartialType(CreateComplianceRuleDto) {}
