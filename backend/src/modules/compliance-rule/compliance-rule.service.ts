import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ComplianceRule, ComplianceRuleDocument } from './compliance-rule.schema';
import { CreateComplianceRuleDto } from './dto/create-compliance-rule.dto';
import { UpdateComplianceRuleDto } from './dto/update-compliance-rule.dto';

@Injectable()
export class ComplianceRuleService {
  constructor(
    @InjectModel(ComplianceRule.name)
    private readonly model: Model<ComplianceRuleDocument>,
  ) {}

  async create(dto: CreateComplianceRuleDto): Promise<ComplianceRuleDocument> {
    return this.model.create(dto);
  }

  async findAll(sourceType?: string, targetType?: string): Promise<ComplianceRuleDocument[]> {
    const filter: Record<string, unknown> = { isActive: true };
    if (sourceType) filter.sourceType = sourceType;
    if (targetType) filter.targetType = targetType;
    return this.model.find(filter).sort({ sortOrder: 1, name: 1 }).exec();
  }

  async findById(id: string): Promise<ComplianceRuleDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ComplianceRule ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`ComplianceRule ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateComplianceRuleDto): Promise<ComplianceRuleDocument> {
    const doc = await this.findById(id);
    Object.assign(doc, dto);
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), isActive: false } })
      .exec();
  }

  /**
   * Validate source entity against a target, applying all active rules
   * where rule.sourceType=sourceType and rule.targetType=targetType.
   * - On `severity=error` violation: throw BadRequestException.
   * - On `severity=warning|info`: log + return list of warnings.
   */
  async validate(
    sourceType: string,
    targetType: string,
    source: Record<string, unknown>,
    target: Record<string, unknown>,
  ): Promise<{ ok: boolean; violations: { ruleId: string; severity: string; message: string }[] }> {
    const rules = await this.findAll(sourceType, targetType);
    const violations: { ruleId: string; severity: string; message: string }[] = [];
    for (const rule of rules) {
      const srcVal = this.resolve(source, rule.field);
      const tgtVal = target ? this.resolve(target, rule.field) : undefined;
      const value = srcVal !== undefined ? srcVal : tgtVal;
      const expected = rule.expectedValue;
      const violation = this.checkViolation(rule.operator, value, expected);
      if (violation) {
        const msg = `${rule.name}: ${rule.field} ${rule.operator} ${expected ?? ''} (got ${value ?? 'undefined'})`;
        violations.push({
          ruleId: rule._id.toString(),
          severity: rule.severity,
          message: msg,
        });
      }
    }
    const errors = violations.filter((v) => v.severity === 'error');
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Compliance violations',
        errors,
      });
    }
    return { ok: violations.length === 0, violations };
  }

  private resolve(obj: Record<string, unknown>, path: string): unknown {
    if (obj == null) return undefined;
    const parts = path.split('.');
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  private checkViolation(
    op: string,
    value: unknown,
    expected?: string,
  ): boolean {
    const num = (x: unknown): number | null => {
      if (x === null || x === undefined) return null;
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    switch (op) {
      case '==':
        return String(value) !== String(expected);
      case '!=':
        return String(value) === String(expected);
      case '<': {
        const a = num(value);
        const b = num(expected);
        return a !== null && b !== null ? !(a < b) : true;
      }
      case '<=': {
        const a = num(value);
        const b = num(expected);
        return a !== null && b !== null ? !(a <= b) : true;
      }
      case '>': {
        const a = num(value);
        const b = num(expected);
        return a !== null && b !== null ? !(a > b) : true;
      }
      case '>=': {
        const a = num(value);
        const b = num(expected);
        return a !== null && b !== null ? !(a >= b) : true;
      }
      case 'in': {
        const opts = (expected ?? '').split(',').map((s) => s.trim());
        return !opts.includes(String(value));
      }
      case 'notIn': {
        const opts = (expected ?? '').split(',').map((s) => s.trim());
        return opts.includes(String(value));
      }
      case 'matches': {
        if (!expected) return false;
        try {
          return !new RegExp(expected).test(String(value));
        } catch {
          return true;
        }
      }
      default:
        return false;
    }
  }
}
