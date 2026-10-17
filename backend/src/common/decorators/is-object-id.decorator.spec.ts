import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsObjectId } from './is-object-id.decorator';

class TestDto {
  @IsObjectId()
  id!: unknown;
}

describe('IsObjectId decorator', () => {
  it('accepts a valid 24-hex string', () => {
    const dto = plainToInstance(TestDto, { id: '507f1f77bcf86cd799439011' });
    expect(validateSync(dto)).toEqual([]);
  });

  it('rejects a non-24-hex string', () => {
    const dto = plainToInstance(TestDto, { id: 'not-an-object-id' });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isObjectId).toBe('id must be a 24-char hex ObjectId');
  });

  it('rejects non-string, non-ObjectId values', () => {
    const dto = plainToInstance(TestDto, { id: 12345 });
    expect(validateSync(dto)).toHaveLength(1);
  });

  it('accepts a Types.ObjectId instance (result of @ToObjectId transform)', () => {
    // TZ-BACKEND-E2E-HARNESS regression: ValidationPipe { transform: true }
    // applies @ToObjectId() (class-transformer) BEFORE class-validator runs,
    // so IsObjectId receives a Types.ObjectId instance, not a string.
    // Previously this failed with 400 "productId must be a 24-char hex ObjectId".
    const dto = plainToInstance(TestDto, {
      id: new Types.ObjectId('507f1f77bcf86cd799439011'),
    });
    expect(validateSync(dto)).toEqual([]);
  });
});
