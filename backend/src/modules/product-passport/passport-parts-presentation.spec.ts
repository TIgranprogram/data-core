import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as fromProduct from './passport-from-product';
import { ProductPassportService } from './product-passport.service';
import type { Doc } from './passport-consts';

describe('C161: источники краткого описания в API', () => {
  const productId = new Types.ObjectId(), partId = new Types.ObjectId(), passportId = new Types.ObjectId();
  const stored = { mode: 'parts' as const, partIds: [partId] };

  function setup() {
    const state = {
      parts: [{ _id: partId, name: 'каркас', genSingular: 'каркаса' }],
      passport: {} as Doc,
      simpleDescription: stored as Doc,
    };
    const findParts = jest.fn(() => ({ toArray: async () => state.parts }));
    const collection = jest.fn((name: string) => ({
      findOne: async () => name === 'products'
        ? { _id: productId, name: 'Изделие', passportDefaults: { simpleDescription: state.simpleDescription } }
        : null,
      find: (filter: Doc) => filter.dict === 'passportParts' ? findParts() : { toArray: async () => [] },
    }));
    jest.spyOn(fromProduct, 'productPatch').mockImplementation(async (_db, _prod, opts) => ({
      passportCategory: 'BLG', name: 'Изделие', description: 'Подробное описание.', manualText: ['description'],
      ...(opts?.presentation ? { simpleDescription: state.simpleDescription } : {}),
    }));
    const saveCurrent = jest.fn();
    const svc = Object.assign(Object.create(ProductPassportService.prototype) as Doc, {
      connection: { db: { collection }, collection },
      categoryRules: async () => new Map(), installs: async () => new Map(),
      standards: async () => ({}), templatesFor: async () => ({}),
      v2All: async () => ({ sections: [], tables: [] }), forest: async () => [], productCtx: async () => undefined,
      effectiveImages: async () => [], revisionList: async () => [],
      findById: async () => ({ toObject: () => structuredClone(state.passport) }),
      saveCurrent,
    });
    return { svc: svc as unknown as ProductPassportService, state, findParts, saveCurrent };
  }

  afterEach(() => jest.restoreAllMocks());

  it('шаблон, проверка и PDF-предпросмотр берут одну фразу, full и legacy сохраняют подробное описание', async () => {
    const { svc, findParts } = setup();
    const text = 'Изделие состоит из каркаса.';
    const template = await svc.passportTemplate(String(productId), 'short');
    expect(template).toMatchObject({
      defaults: { simpleDescription: { mode: 'parts', partIds: [String(partId)] } },
      simpleDescriptionSource: { kind: 'parts', partIds: [String(partId)], text },
      textSnapshot: { description: text },
    });
    expect(template.defaults.simpleDescription).not.toHaveProperty('text');
    expect(findParts).toHaveBeenCalledTimes(1);
    await expect(svc.check({ productId: String(productId), presentationVersion: 1, variant: 'short' }))
      .resolves.toMatchObject({ missing: template.readiness.missing });
    await expect(svc.previewDoc(String(productId), 1, 'short')).resolves.toMatchObject({ textSnapshot: { description: text } });
    const fullText = { textSnapshot: { description: 'Подробное описание.' } };
    await expect(svc.previewDoc(String(productId), 1, 'full')).resolves.toMatchObject(fullText);
    await expect(svc.previewDoc(String(productId))).resolves.toMatchObject(fullText);
    expect(findParts).toHaveBeenCalledTimes(3);
  });

  it('после переименования и удаления части шаблон обновляется, пересборка выданного требует новой редакции', async () => {
    const { svc, state, findParts, saveCurrent } = setup();
    const first = await svc.passportTemplate(String(productId));
    state.passport = {
      _id: String(passportId), presentationVersion: 1, variant: 'short', status: 'issued', passportNumber: 'C161', revision: 1,
      simpleDescription: { mode: 'parts', partIds: [String(partId)] }, textSnapshot: first.textSnapshot,
      printSnapshot: { readiness: { ...first.readiness, ready: true, missing: [] } },
    };
    const frozen = structuredClone(state.passport);
    const expectSnapshotConflict = async (message = 'Чтобы изменить текст, создайте новую редакцию.') => {
      const attempt = svc.snapshot(String(passportId));
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(message);
    };
    state.parts = [{ _id: partId, name: 'рама', genSingular: 'рамы' }];
    await expect(svc.passportTemplate(String(productId))).resolves.toMatchObject({ textSnapshot: { description: 'Изделие состоит из рамы.' } });
    await expectSnapshotConflict();
    state.parts = [];
    const current = await svc.passportTemplate(String(productId));
    expect(current).toMatchObject({
      textSnapshot: { description: '' },
      simpleDescriptionSource: { kind: 'parts', text: '', invalidPartIds: [String(partId)] },
      readiness: { ready: false, missing: expect.arrayContaining([expect.objectContaining({ key: 'simpleDescription', hint: expect.stringContaining(String(partId)) })]) },
    });
    await expectSnapshotConflict();
    const issued = await svc.get(String(passportId), { readOnly: true });
    expect(issued).toMatchObject({ revision: 1, textSnapshot: first.textSnapshot, simpleDescriptionSource: first.simpleDescriptionSource, readiness: { ready: true, missing: [] } });
    expect(state.passport).toEqual(frozen);
    state.passport.status = 'annulled';
    await expectSnapshotConflict('Паспорт аннулирован — изменить его нельзя');
    const annulled = await svc.get(String(passportId), { readOnly: true });
    expect(annulled).toMatchObject({ status: 'annulled', revision: 1, textSnapshot: first.textSnapshot, simpleDescriptionSource: first.simpleDescriptionSource });
    expect(state.passport).toEqual({ ...frozen, status: 'annulled' });
    expect(saveCurrent).not.toHaveBeenCalled();
    expect(findParts).toHaveBeenCalledTimes(3);
  });

  it('устаревшая ручная фраза остаётся своей до явной смены режима', async () => {
    const { svc, state, findParts } = setup();
    state.simpleDescription = { text: 'Старая формулировка.', partIds: [partId] };
    await expect(svc.passportTemplate(String(productId))).resolves.toMatchObject({
      defaults: { simpleDescription: { text: 'Старая формулировка.', partIds: [String(partId)] } },
      textSnapshot: { description: 'Старая формулировка.' },
      simpleDescriptionSource: { kind: 'own' },
    });
    expect(findParts).not.toHaveBeenCalled();
  });
});
