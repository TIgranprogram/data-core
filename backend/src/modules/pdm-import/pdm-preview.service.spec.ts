import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { rmSync } from 'fs';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PdmPreviewService, imageTypeOf } from './pdm-preview.service';
import { miniTree } from './pdm-tree.testkit';

const user = { id: new Types.ObjectId().toHexString(), username: 'admin', role: 'admin' } as AuthenticatedUser;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('картинка')]);
const sha = createHash('sha256').update(PNG).digest('hex');
const DES = '0000.1005.0001';
const q = (value: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'lean']) c[m] = () => c; c.exec = async () => value; return c; };

function setup(owner: Record<string, unknown>, photos: { same?: boolean; mainFromPdm?: boolean } = {}) {
  const ownerId = new Types.ObjectId(), photoId = new Types.ObjectId();
  const imp = { _id: new Types.ObjectId(), status: 'applied', tree: JSON.parse(JSON.stringify(miniTree())), owners: { [DES]: { kind: 'material', id: ownerId } } };
  const ownerUpdates: unknown[] = [], photoUpdates: unknown[] = [];
  const materials = { findOne: () => q({ _id: ownerId, ...owner }), updateOne: (f: unknown, u: unknown) => { ownerUpdates.push(u); return { exec: async () => ({}) }; } };
  const photoModel = {
    findOne: () => q(photos.same ? { _id: photoId } : null),
    exists: async () => (photos.mainFromPdm ? { _id: 1 } : null),
    updateOne: (_f: unknown, u: unknown) => { photoUpdates.push(u); return { exec: async () => ({}) }; },
  };
  const photoService = { upload: jest.fn(async () => ({ original: { _id: photoId } })) };
  const service = new PdmPreviewService({ findOne: () => q(imp) } as never, materials as never, {} as never, {} as never, photoModel as never, photoService as never);
  return { service, ownerUpdates, photoUpdates, photoService, photoId };
}
const form = (over: Record<string, string> = {}) => ({ importId: new Types.ObjectId().toHexString(), designation: DES, sha256: sha, ...over });

describe('PdmPreviewService.save', () => {
  beforeAll(() => { process.env.UPLOAD_DIR = './uploads-test-pdm-preview'; });
  afterAll(() => { rmSync('./uploads-test-pdm-preview', { recursive: true, force: true }); delete process.env.UPLOAD_DIR; });

  it('нет главного фото — новое становится главным, фото помечено источником PDM', async () => {
    const s = setup({ photoIds: [] });
    const r = await s.service.save(form(), PNG, user);
    expect(r).toEqual({ photoId: String(s.photoId), stored: true, main: true });
    expect(s.photoUpdates[0]).toEqual({ $set: { source: 'pdm', sha256: sha } });
    expect(s.ownerUpdates[0]).toEqual({ $addToSet: { photoIds: s.photoId }, $set: { mainPhotoId: s.photoId } });
    expect(s.photoService.upload).toHaveBeenCalledWith(expect.objectContaining({ mimetype: 'image/png' }), 'showcase');
  });

  it('главное фото менеджера не перебивается: фото добавляется, главное прежнее', async () => {
    const s = setup({ photoIds: [new Types.ObjectId()], mainPhotoId: new Types.ObjectId() });
    const r = await s.service.save(form(), PNG, user);
    expect(r.main).toBe(false);
    expect(s.ownerUpdates[0]).toEqual({ $addToSet: { photoIds: s.photoId } });
  });

  it('прежнее главное тоже из PDM — заменяется', async () => {
    const s = setup({ photoIds: [new Types.ObjectId()], mainPhotoId: new Types.ObjectId() }, { mainFromPdm: true });
    expect((await s.service.save(form(), PNG, user)).main).toBe(true);
  });

  it('повтор того же sha256 у владельца — stored:false, ничего не пишется', async () => {
    const s = setup({ photoIds: [new Types.ObjectId()] }, { same: true });
    expect(await s.service.save(form(), PNG, user)).toMatchObject({ stored: false, photoId: String(s.photoId) });
    expect(s.photoService.upload).not.toHaveBeenCalled();
    expect(s.ownerUpdates).toHaveLength(0);
  });

  it('обозначения нет в плане — 400; не картинка — 400; чужая сумма — 400', async () => {
    const s = setup({});
    await expect(s.service.save(form({ designation: 'нет-такого' }), PNG, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.service.save(form(), Buffer.from('MZ-not-image'), user)).rejects.toThrow('PNG или JPEG');
    await expect(s.service.save(form({ sha256: 'f'.repeat(64) }), PNG, user)).rejects.toThrow('Контрольная сумма');
  });

  it('тип по сигнатуре', () => {
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageTypeOf(Buffer.from('GIF89a'))).toBeNull();
  });
});
