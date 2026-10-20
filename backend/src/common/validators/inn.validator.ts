import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Russian INN (taxpayer identification number) validator.
 *  - 10 digits for legal entities
 *  - 12 digits for individuals / sole proprietors
 *  - Validates checksum using the official FNS algorithm.
 */
@ValidatorConstraint({ name: 'isINN', async: false })
class IsINNConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (!/^\d{10}$|^\d{12}$/.test(value)) return false;

    return value.length === 10 ? this.checkInn10(value) : this.checkInn12(value);
  }

  defaultMessage(args: ValidationArguments): string {
    const v = args.value as string;
    if (typeof v !== 'string' || !/^\d+$/.test(v)) {
      return 'INN must be a numeric string';
    }
    if (v.length !== 10 && v.length !== 12) {
      return 'INN must be 10 (legal) or 12 (individual) digits';
    }
    return 'INN checksum is invalid';
  }

  // 10-digit: weighted sum mod 11 mod 10 = 10th digit (index 9)
  private checkInn10(inn: string): boolean {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];

    let s = 0;
    for (let i = 0; i < 9; i++) s += Number(inn[i]) * w[i];
    const check = (s % 11) % 10;

    return check === Number(inn[9]);
  }

  // 12-digit: two-stage weighted sum (two check digits at positions 11 and 12)
  private checkInn12(inn: string): boolean {
    const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

    let s1 = 0;
    for (let i = 0; i < 10; i++) s1 += Number(inn[i]) * w1[i];
    const d11 = (s1 % 11) % 10;

    let s2 = 0;
    for (let i = 0; i < 11; i++) s2 += Number(inn[i]) * w2[i];
    const d12 = (s2 % 11) % 10;

    return d11 === Number(inn[10]) && d12 === Number(inn[11]);
  }
}

export function IsINN(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isINN',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      constraints: [],
      validator: IsINNConstraint,
    });
  };
}
