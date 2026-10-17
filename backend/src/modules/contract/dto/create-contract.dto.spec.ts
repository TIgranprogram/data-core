import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContractDto } from './create-contract.dto';
import { UpdateContractDto } from './update-contract.dto';

const BASE = {
  organizationId: '507f1f77bcf86cd799439011',
  customerId: '507f1f77bcf86cd799439012',
  items: [],
};

describe('Contract attachment DTO validation (C2)', () => {
  it('rejects file_attached without a file id or URL', async () => {
    const dto = plainToInstance(CreateContractDto, {
      ...BASE,
      contractStatus: 'file_attached',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'contractStatus')).toBe(true);
  });

  it('accepts file_attached with an attachment URL', async () => {
    const dto = plainToInstance(CreateContractDto, {
      ...BASE,
      contractStatus: 'file_attached',
      attachmentUrl: 'https://files.example.test/contracts/contract.pdf',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('allows generated without a file reference', async () => {
    const dto = plainToInstance(CreateContractDto, {
      ...BASE,
      contractStatus: 'generated',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('applies the same file_attached rule to the partial update DTO', async () => {
    const dto = plainToInstance(UpdateContractDto, {
      contractStatus: 'file_attached',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'contractStatus')).toBe(true);
  });
});
