import { Reflector } from '@nestjs/core';
import { promises as fs } from 'fs';
import mongoose, { Types } from 'mongoose';
import * as path from 'path';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UPLOAD_DIR } from '../photos/image-upload.options';
import { assertOneOwner, currentOf, SUPPLIER_PASSPORT_TYPE } from './attachment-owner';
import { MaterialAttachmentFileController, MaterialAttachmentsController } from './productattachments.controller';
import { ProductAttachmentSchema } from './productattachment.schema';
import { ProductAttachmentsService } from './productattachments.service';

const hex = (c: string) => c.repeat(24);
const MAT = hex('a');
const TYPE = hex('b');

describe('паспорт поставщика (C136): владелец файла', () => {
  it('ровно одно из productId / materialId', () => {
    expect(() => assertOneOwner({ productId: hex('1') })).not.toThrow();
    expect(() => assertOneOwner({ materialId: hex('2') })).not.toThrow();
    expect(() => assertOneOwner({})).toThrow('ровно одно');
    expect(() => assertOneOwner({ productId: hex('1'), materialId: hex('2') })).toThrow('ровно одно');
  });

  it('схема не пропускает запись без владельца и с двумя', async () => {
    const M = mongoose.models.SupplierSpecAtt ?? mongoose.model('SupplierSpecAtt', ProductAttachmentSchema);
    const base = { typeId: new Types.ObjectId(), originalName: 'a.pdf', storedPath: 'attachments/x/y/z.pdf', size: 1, ext: 'pdf' };
    await expect(new M({ ...base }).validate()).rejects.toThrow('ровно одно');
    await expect(new M({ ...base, productId: new Types.ObjectId(), materialId: new Types.ObjectId() }).validate()).rejects.toThrow('ровно одно');
    await expect(new M({ ...base, materialId: new Types.ObjectId() }).validate()).resolves.toBeUndefined();
    await expect(new M({ ...base, productId: new Types.ObjectId() }).validate()).resolves.toBeUndefined();
  });

  it('действующий — последний живой; убранные не считаются', () => {
    const rows = [
      { _id: 1, uploadedAt: '2026-11-01', deletedAt: null },
      { _id: 2, uploadedAt: '2026-11-10', deletedAt: null },
      { _id: 3, uploadedAt: '2026-11-15', deletedAt: new Date() },
    ];
    expect(currentOf(rows)?._id).toBe(2);
    expect(currentOf([{ _id: 3, deletedAt: new Date() }])).toBeNull();
  });
});

describe('паспорт поставщика: загрузка и замена', () => {
  const dir = path.join(path.resolve(UPLOAD_DIR), 'attachments', MAT, TYPE);
  afterAll(() => fs.rm(path.join(path.resolve(UPLOAD_DIR), 'attachments', MAT), { recursive: true, force: true }));

  const make = (kind: string | null, calls: Array<[string, unknown]>) => {
    const model = {
      create: async (d: Record<string, unknown>) => { calls.push(['create', d]); return { _id: new Types.ObjectId(), uploadedAt: new Date(), ...d }; },
      updateMany: async (f: unknown, u: unknown) => { calls.push(['updateMany', { f, u }]); return {}; },
    };
    const col = (name: string) => ({
      findOne: async () => (name === 'materials' ? (kind === null ? null : { _id: MAT, materialKind: kind }) : { _id: new Types.ObjectId(TYPE), name: SUPPLIER_PASSPORT_TYPE }),
    });
    return new ProductAttachmentsService(model as never, {} as never, { db: { collection: col } } as never);
  };
  const upload = async () => {
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, `${new Types.ObjectId().toHexString()}.pdf`);
    await fs.writeFile(p, Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(100)]));
    return { path: p, originalname: 'Паспорт.pdf', size: 108, mimetype: 'application/pdf' };
  };

  it('покупной материал: запись с materialId без productId, старый файл уходит в корзину', async () => {
    const calls: Array<[string, unknown]> = [];
    const r = await make('purchased', calls).save(await upload(), MAT, TYPE, { id: 'u' } as never, undefined, 'materialId');
    expect(r.materialId).toBe(MAT);
    expect(r.productId).toBeNull();
    const created = calls.find((c) => c[0] === 'create')![1] as Record<string, unknown>;
    expect(created.productId).toBeUndefined();
    expect(String(created.materialId)).toBe(MAT);
    const upd = calls.find((c) => c[0] === 'updateMany')![1] as { f: Record<string, unknown>; u: { $set: Record<string, unknown> } };
    expect(upd.f.deletedAt).toBeNull();
    expect(upd.u.$set.deletedAt).toBeInstanceOf(Date);
  });

  it('не покупной материал — 400, файл стирается; нет материала — 404', async () => {
    const f = await upload();
    await expect(make('raw', []).save(f, MAT, TYPE, { id: 'u' } as never, undefined, 'materialId')).rejects.toThrow('только у покупных');
    await expect(fs.stat(f.path)).rejects.toThrow();
    await expect(make(null, []).save(await upload(), MAT, TYPE, { id: 'u' } as never, undefined, 'materialId')).rejects.toThrow('Материал не найден');
  });

  it('права: смотрят четыре роли, грузят admin и manager, удаляет admin; скачивание публично по тикету', () => {
    const r = new Reflector();
    const p = MaterialAttachmentsController.prototype;
    expect(r.get(ROLES_KEY, p.list)).toEqual(expect.arrayContaining(['admin', 'director', 'manager', 'user']));
    expect(r.get(ROLES_KEY, p.upload)).toEqual(['admin', 'manager']);
    expect(r.get(ROLES_KEY, p.remove)).toEqual(['admin']);
    expect(r.get(ROLES_KEY, p.ticket)).toEqual(expect.arrayContaining(['user']));
    expect(r.get('isPublic', MaterialAttachmentFileController)).toBeTruthy();
    for (const m of ['upload', 'remove'] as const) expect(r.get('auditAction', p[m])).toBeDefined();
  });
});
