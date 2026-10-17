import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrganizationService } from './organization.service';

describe('OrganizationService (TZ-PARTY-301 tenant hygiene)', () => {
  const ownOrgId = new Types.ObjectId().toString();
  const otherOrgId = new Types.ObjectId().toString();

  function makePhotos(overrides: Record<string, unknown> = {}) {
    return {
      create: jest.fn().mockImplementation((dto: Record<string, unknown>) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...dto }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function makeService(model: unknown, photos: unknown = makePhotos()) {
    return new OrganizationService(model as any, photos as any);
  }

  function makeModel(overrides: Record<string, unknown> = {}) {
    return {
      create: jest.fn().mockImplementation((payload: unknown) => Promise.resolve(payload)),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      ...overrides,
    };
  }

  function makeDoc(id: string) {
    const doc: Record<string, unknown> = { _id: new Types.ObjectId(id), name: 'ООО Наша' };
    doc.save = jest.fn().mockResolvedValue(doc);
    return doc;
  }

  it('list hides organizations of other tenants and deleted rows', async () => {
    const model = makeModel();
    const service = makeService(model);

    await service.findAll({}, { organizationId: ownOrgId, role: 'manager' });

    const filter = model.find.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.deletedAt).toBeNull();
    expect(String(filter._id)).toBe(ownOrgId);
  });

  it('list without a bound organization stays unscoped for bootstrap', async () => {
    const model = makeModel();
    const service = makeService(model);

    await service.findAll({});

    const filter = model.find.mock.calls[0][0] as Record<string, unknown>;
    expect(filter._id).toBeUndefined();
    expect(filter.deletedAt).toBeNull();
  });

  it('findById hides another tenant organization behind 404 (IDOR)', async () => {
    const model = makeModel();
    const service = makeService(model);

    await expect(
      service.findById(otherOrgId, { organizationId: ownOrgId, role: 'manager' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('findById returns the own organization and skips deleted rows', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = makeService(model);

    await expect(
      service.findById(ownOrgId, { organizationId: ownOrgId, role: 'manager' }),
    ).resolves.toBe(doc);
    expect(model.findOne).toHaveBeenCalledWith({ _id: ownOrgId, deletedAt: null });
  });

  it('current resolves the organization bound to the user', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = makeService(model);

    await expect(
      service.findCurrent({ organizationId: ownOrgId, role: 'manager' }),
    ).resolves.toBe(doc);
  });

  it('current falls back to the organization flagged as our company', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = makeService(model);

    await expect(service.findCurrent()).resolves.toBe(doc);
    expect(model.findOne).toHaveBeenCalledWith({ isOurCompany: true, deletedAt: null });
  });

  it('current falls back to the only organization in the instance', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel({
      find: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([doc]) }),
      }),
    });
    const service = makeService(model);

    await expect(service.findCurrent()).resolves.toBe(doc);
  });

  it('current asks the operator to choose when several organizations exist', async () => {
    const model = makeModel({
      find: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([makeDoc(ownOrgId), makeDoc(otherOrgId)]),
        }),
      }),
    });
    const service = makeService(model);

    await expect(service.findCurrent()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove soft-deletes by writing deletedAt', async () => {
    const doc = makeDoc(ownOrgId);
    const model = makeModel({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = makeService(model);

    await service.remove(ownOrgId, { organizationId: ownOrgId, role: 'admin' });

    const [filter, update] = model.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter._id).toBe(doc._id);
    expect(update.$set.deletedAt).toBeInstanceOf(Date);
  });

  it('remove refuses another tenant organization', async () => {
    const model = makeModel();
    const service = makeService(model);

    await expect(
      service.remove(otherOrgId, { organizationId: ownOrgId, role: 'admin' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  describe('typed asset vault (TZ-ORG-ASSETS-301)', () => {
    const file = {
      filename: 'abc.png',
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: 4096,
    };
    const admin = { organizationId: ownOrgId, role: 'admin' };
    const manager = { organizationId: ownOrgId, role: 'manager' };

    type Asset = Record<string, unknown>;

    /**
     * Слоты пишутся не через `doc.save()` (его роняет optimisticLockPlugin на
     * массивах), а через findOneAndUpdate: `$set` на замену и `$pull` на
     * снятие. Мок исполняет обе формы, чтобы тест проверял поведение, а не
     * форму вызова.
     */
    function withDoc(assets: Asset[] = []) {
      const doc = makeDoc(ownOrgId);
      const state = { assets: [...assets] };
      const findOneAndUpdate = jest.fn((_filter: unknown, update: unknown) => {
        const { $set, $pull } = update as {
          $set?: { assets: Asset[] };
          $pull?: { assets: { role: string } };
        };
        if ($set) state.assets = $set.assets;
        if ($pull) state.assets = state.assets.filter((a) => a.role !== $pull.assets.role);
        return { exec: jest.fn().mockResolvedValue({ ...doc, assets: state.assets }) };
      });
      doc.assets = state.assets;
      const model = makeModel({
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
        findOneAndUpdate,
      });
      return { doc, model, state };
    }

    it('putAsset stores the file in the requested slot with author and url', async () => {
      const { model, state } = withDoc();
      const photos = makePhotos();
      const service = makeService(model, photos);
      const uploader = new Types.ObjectId().toString();

      await service.putAsset(ownOrgId, 'logo', file, manager, uploader);

      expect(state.assets).toHaveLength(1);
      expect(state.assets[0]!.role).toBe('logo');
      expect(state.assets[0]!.storageUrl).toBe('/uploads/abc.png');
      expect(state.assets[0]!.mimeType).toBe('image/png');
      expect(String(state.assets[0]!.uploadedBy)).toBe(uploader);
      expect(photos.create).toHaveBeenCalledWith(
        expect.objectContaining({ storageUrl: '/uploads/abc.png', variant: 'original' }),
      );
    });

    it('putAsset replaces the slot instead of piling up versions', async () => {
      const oldPhotoId = new Types.ObjectId();
      const { model, state } = withDoc([
        { role: 'logo', photoId: oldPhotoId, storageUrl: '/uploads/old.png' },
        { role: 'signature', photoId: new Types.ObjectId(), storageUrl: '/uploads/sig.png' },
      ]);
      const photos = makePhotos();
      const service = makeService(model, photos);

      await service.putAsset(ownOrgId, 'logo', file, manager);

      expect(state.assets.filter((a) => a.role === 'logo')).toHaveLength(1);
      expect(state.assets.map((a) => a.role)).toContain('signature');
      expect(photos.remove).toHaveBeenCalledWith(oldPhotoId.toString());
    });

    it('putAsset keeps the new file when cleaning up the old one fails', async () => {
      const { model, state } = withDoc([
        { role: 'logo', photoId: new Types.ObjectId(), storageUrl: '/uploads/old.png' },
      ]);
      const photos = makePhotos({ remove: jest.fn().mockRejectedValue(new Error('gone')) });
      const service = makeService(model, photos);

      await expect(service.putAsset(ownOrgId, 'logo', file, manager)).resolves.toBeDefined();
      expect(state.assets[0]!.storageUrl).toBe('/uploads/abc.png');
    });

    it('putAsset lets only admin touch the seal', async () => {
      const { model } = withDoc();
      const service = makeService(model);

      await expect(service.putAsset(ownOrgId, 'seal', file, manager)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(model.findOne).not.toHaveBeenCalled();

      await expect(service.putAsset(ownOrgId, 'seal', file, admin)).resolves.toBeDefined();
    });

    it('putAsset refuses an unknown slot', async () => {
      const { model } = withDoc();
      const service = makeService(model);

      await expect(
        service.putAsset(ownOrgId, 'stamp' as never, file, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('putAsset hides another tenant organization behind 404', async () => {
      const model = makeModel();
      const service = makeService(model);

      await expect(service.putAsset(otherOrgId, 'logo', file, manager)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('removeAsset clears the slot and deletes the file', async () => {
      const photoId = new Types.ObjectId();
      const { model, state } = withDoc([
        { role: 'logo', photoId, storageUrl: '/uploads/old.png' },
      ]);
      const photos = makePhotos();
      const service = makeService(model, photos);

      await service.removeAsset(ownOrgId, 'logo', manager);

      expect(state.assets).toHaveLength(0);
      expect(photos.remove).toHaveBeenCalledWith(photoId.toString());
    });

    it('removeAsset reports an empty slot instead of silently succeeding', async () => {
      const { model } = withDoc();
      const service = makeService(model);

      await expect(service.removeAsset(ownOrgId, 'logo', manager)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('removeAsset lets only admin drop the seal', async () => {
      const { model } = withDoc([
        { role: 'seal', photoId: new Types.ObjectId(), storageUrl: '/uploads/seal.png' },
      ]);
      const service = makeService(model);

      await expect(service.removeAsset(ownOrgId, 'seal', manager)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
