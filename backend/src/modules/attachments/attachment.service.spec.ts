import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AttachmentService } from './attachment.service';

function query<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('AttachmentService (TZ-CATALOG-313)', () => {
  const organizationId = new Types.ObjectId();
  const productId = new Types.ObjectId();
  const attachmentId = new Types.ObjectId();

  function setup() {
    const model = {
      create: jest.fn().mockResolvedValue({ _id: attachmentId }),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn(),
    };
    const productModel = { findById: jest.fn().mockReturnValue(query({ _id: productId, organizationId })) };
    const moduleModel = { findById: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId() })) };
    const materialModel = { findById: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), organizationId })) };
    return { service: new AttachmentService(model as never, productModel as never, moduleModel as never, materialModel as never), model, productModel, moduleModel, materialModel };
  }

  it('creates a typed Product attachment and derives its organization', async () => {
    const { service, model } = setup();
    await service.create({
      entityType: 'Product', entityId: productId.toString(), type: 'drawing',
      name: 'Drawing', storageUrl: '/uploads/drawing.pdf', mimeType: 'application/pdf',
    }, { organizationId: organizationId.toString() });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'Product', entityId: productId, type: 'drawing', organizationId,
    }));
  });

  it('accepts shared ProductModule parents without inventing organization ownership', async () => {
    const { service, model } = setup();
    const moduleId = new Types.ObjectId();
    await service.create({
      entityType: 'ProductModule', entityId: moduleId.toString(), type: 'manual',
      name: 'Module manual', storageUrl: '/uploads/manual.pdf',
    }, { organizationId: organizationId.toString() });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'ProductModule', entityId: moduleId, organizationId: undefined,
    }));
  });

  it('rejects a parent outside the authenticated organization', async () => {
    const { service, productModel } = setup();
    productModel.findById.mockReturnValue(query({ _id: productId, organizationId: new Types.ObjectId() }));
    await expect(service.create({
      entityType: 'Product', entityId: productId.toString(), type: 'passport',
      name: 'Passport', storageUrl: '/uploads/passport.pdf',
    }, { organizationId: organizationId.toString() })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes an attachment and does not touch legacy document collections', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { service } = setup();
    (service as never as { model: { findOne: jest.Mock } }).model.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: attachmentId,
        entityType: 'Product',
        entityId: productId,
        isActive: true,
        save,
      }),
    });
    await service.remove(attachmentId.toString(), { organizationId: organizationId.toString() });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
