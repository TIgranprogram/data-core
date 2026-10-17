import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ComplianceRule, ComplianceRuleSchema } from './compliance-rule.schema';
import { ComplianceRuleService } from './compliance-rule.service';
import { ComplianceRuleController } from './compliance-rule.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ComplianceRule.name, schema: ComplianceRuleSchema },
    ]),
  ],
  controllers: [ComplianceRuleController],
  providers: [ComplianceRuleService],
  exports: [ComplianceRuleService],
})
export class ComplianceRuleModule {}
