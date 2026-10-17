import { BadRequestException } from '@nestjs/common';
import { ContractController } from './contract.controller';

function buildController() {
  const service = {
    attachFile: jest.fn(),
    removeAttachment: jest.fn(),
  };
  return { controller: new ContractController(service as never), service };
}

describe('ContractController attachment endpoints', () => {
  const file = {
    originalname: 'signed-contract.pdf',
    mimetype: 'application/pdf',
    size: 128,
    buffer: Buffer.from('pdf'),
  } as unknown as Express.Multer.File;

  it('forwards PUT attachment file to the service', async () => {
    const { controller, service } = buildController();
    const result = { contractStatus: 'file_attached', attachmentUrl: '/uploads/contracts/file.pdf' };
    service.attachFile.mockResolvedValue(result);

    await expect(controller.attachFile('contract-id', file)).resolves.toBe(result);
    expect(service.attachFile).toHaveBeenCalledWith('contract-id', file);
  });

  it('rejects PUT attachment without a file', async () => {
    const { controller, service } = buildController();

    expect(() => controller.attachFile('contract-id', undefined)).toThrow(BadRequestException);
    expect(service.attachFile).not.toHaveBeenCalled();
  });

  it('rejects an empty PUT attachment', async () => {
    const { controller, service } = buildController();

    expect(() =>
      controller.attachFile('contract-id', { ...file, size: 0 }),
    ).toThrow(BadRequestException);
    expect(service.attachFile).not.toHaveBeenCalled();
  });

  it('forwards DELETE attachment to the service', async () => {
    const { controller, service } = buildController();
    const result = { contractStatus: 'none' };
    service.removeAttachment.mockResolvedValue(result);

    await expect(controller.removeAttachment('contract-id')).resolves.toBe(result);
    expect(service.removeAttachment).toHaveBeenCalledWith('contract-id');
  });
});
