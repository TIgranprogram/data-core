import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { ProductModulePhotoService } from './product-module-photo.service';

describe('ProductModulePhotoService (TZ-CATALOG-313 compatibility)', () => {
  const moduleId = new Types.ObjectId();
  const photoId = new Types.ObjectId();

  function setup() {
    const created = { _id: new Types.ObjectId(), productModuleId: moduleId, photoId, isMain: true, save: jest.fn() };
    const model = {
      create: jest.fn().mockResolvedValue(created),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      findById: jest.fn(),
    };
    const moduleModel = {
      findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue({ _id: moduleId }) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    return { service: new ProductModulePhotoService(model as never, moduleModel as never), model, moduleModel, created };
  }

  it('keeps legacy row and adds a shared photo reference on attach', async () => {
    const { service, model, moduleModel } = setup();
    await service.upsert({ productModuleId: moduleId.toString(), photoId: photoId.toString(), isMain: true });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ productModuleId: moduleId, photoId, isMain: true }));
    expect(moduleModel.updateOne).toHaveBeenCalledWith(
      { _id: moduleId },
      { $addToSet: { photoIds: photoId }, $set: { mainPhotoId: photoId } },
    );
  });

  it('does not destroy module photo rows when a legacy module is missing', async () => {
    const { service } = setup();
    const moduleModel = (service as never as { moduleModel: { findById: jest.Mock } }).moduleModel;
    moduleModel.findById.mockReturnValue({ select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) });
    await expect(service.upsert({ productModuleId: moduleId.toString(), url: 'https://cdn.test/a.jpg' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not pull canonical references when removing a legacy row', async () => {
    const { service, moduleModel } = setup();
    const deleted = jest.fn().mockResolvedValue(undefined);
    (service as never as { model: { findById: jest.Mock } }).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ productModuleId: moduleId, photoId, deleteOne: deleted }),
    });
    await service.remove(new Types.ObjectId().toString());
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(moduleModel.updateOne).not.toHaveBeenCalled();
  });
});
