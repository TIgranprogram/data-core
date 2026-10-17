import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RuleOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'notIn'
  | 'matches';
export type RuleSeverity = 'info' | 'warning' | 'error';
export type ComplianceRuleDocument = HydratedDocument<ComplianceRule>;

@Schema({ softDelete: false,  collection: 'compliancerules', timestamps: true })
export class ComplianceRule {
  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ required: true, index: true })
  sourceType!: string;

  @Prop({ required: true, index: true })
  targetType!: string;

  @Prop({ required: true })
  field!: string;

  @Prop()
  fieldLabel?: string;

  @Prop({ required: true, enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'notIn', 'matches'] })
  operator!: RuleOperator;

  @Prop()
  expectedValue?: string;

  @Prop()
  expectedValueMax?: string;

  @Prop({ default: 0 })
  tolerance?: number;

  @Prop()
  unit?: string;

  @Prop({ required: true, enum: ['info', 'warning', 'error'], default: 'warning' })
  severity!: RuleSeverity;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export const ComplianceRuleSchema = SchemaFactory.createForClass(ComplianceRule);
ComplianceRuleSchema.index({ sourceType: 1, targetType: 1, isActive: 1 });
